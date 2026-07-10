# Electron + React IM 接入准则

本文记录 Electron + React IM 宿主接入 XMessageList 时的增量准则。前提是宿主已经拥有 canonical message、conversation 和 feed stores；本文不重写既有架构文档，而是承载接入方设计评审中形成的共识、边界和后续实现标准。

## 最终命名

- `latest` 表示数据源的最新消息区间，不表示 viewport 当前吸底。
- `bottomLockState` 表示 viewport 是否贴在底部，是滚动状态。
- `session.tail.local` / `session.tail.remote` 是尾部追加 API 分组，不替代 `latest` 词汇。
- `state.loaded.context` 表示当前 loaded rows 的语义上下文：

```ts
type MessageListLoadedContext = 'latest' | 'history' | 'around';
```

`latest` context 表示当前 loaded segment 代表最新消息区间。用户可以向上滚动、加载更早历史，并让 `bottomLockState` 变成 `UNLOCKED`，但 `loaded.context` 仍保持 `latest`。

`history` context 表示宿主显式恢复或打开了一个非最新历史窗口，并且它不是一次目标跳转。普通从 latest 向上滚动不会产生 `history`。

`around` context 表示 loaded segment 是围绕一个用户目标构建的窗口，例如搜索结果、回复定位或 `scrollToMessage`。

## Session 身份与 Source

当一个全局唯一 `feedId` 对应一份独立阅读状态时，宿主可以直接把它映射为 `sessionId`：

```ts
const sessionId = feedId;
const session = registry.getSession(sessionId);
```

`Session Source` 仍应使用最小结构化对象，而不是裸字符串。这样 request route 和 adapter 行为有稳定扩展点：

```ts
type ImMessageListSource = {
  feedId: string;
  kind: 'chat' | 'thread' | 'channel' | 'favorite' | 'ai';
};
```

source 字段属于 session static semantics。如果 source 语义发生变化，宿主应销毁并重建 session，而不是把既有 session 原地变成另一种列表。

## Host Store 边界

SDK、main process 和 bridge callback 必须先进入宿主 canonical stores。XMessageList 只接收与当前 loaded segment 有关的归一化变化，或显式用户可见 session 行为。

```text
main / SDK / bridge
-> host message, conversation, and feed stores
-> MessageListSession public API
-> XMessageList
```

adapter request 层是宿主 query facade。它可以读取 renderer canonical store、请求 main process、调用 SDK API 或组合这些来源；XMessageList 只表达需要哪类窗口：latest、before、after 或 around。

## Request 合同

`MessageListRequestContext` 应暴露结构化 trigger：

```ts
type MessageListRequestTrigger =
  | 'viewport'
  | 'command'
  | 'restore'
  | 'internal';
```

`trigger='viewport'` 只保留给真实 mounted viewport 的 before / after edge need。bootstrap、underflow fill、restore、manual command 和 edge retry 都不是 viewport trigger。

`commands.loadBefore`、`commands.loadAfter` 和 edge retry 使用 `trigger='command'`。

`onRequestResult` 应携带同一个 trigger，便于诊断解释某次请求为什么触发或没有触发 bottom-lock 行为。

## Page 合同

`MessageListPage` 应增加显式 latest reach metadata：

```ts
type MessageListPage<Row> = {
  rows: Row[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  reachedLatest?: boolean;
};
```

`loadLatest`、`rows.resetLatest(page)` 和 `tail.local.stage({ latest })` 都要求 latest page 满足 `hasMoreAfter=false`。如果 latest page 返回 `hasMoreAfter=true`，XMessageList 应视为 contract violation，而不是自动归一化。

`reachedLatest=true` 只用于 after page 证明某个 historical window 已抵达最新消息区间的场景。它也必须满足 `hasMoreAfter=false`。

## Loaded Context 流转

核心状态流转：

```text
loadLatest / resetLatest / clear:
  context = 'latest'

user scrolls upward in latest:
  context remains 'latest'
  bottomLockState may become UNLOCKED

latest + loadBefore:
  context remains 'latest'

anchorMemory restore:
  context = 'history'

scrollToMessage / loadAround / resetAround:
  context = 'around'

scrollToLatest from history or around:
  loadLatest -> resetLatest -> context = 'latest' -> follow bottom
```

当真实 viewport after-edge request 把 `history` window 推进到最新消息区间时，XMessageList 应使用既有 bottom-follow / bottom-lock 机制：

```text
context='history'
trigger='viewport'
kind='after'
page.reachedLatest=true
page.hasMoreAfter=false
  -> context='latest'
  -> arm existing bottom-lock settle
```

manual 或 programmatic after paging 可以把 `history` 提升为 `latest`，但不能自动吸底；除非该 command 本身明确要求 follow 行为。

`around` 不会通过 edge paging 自动提升为 `latest`。如果 around request 返回 `reachedLatest=true`，XMessageList 应发出 warning，并保持 `context='around'`。

## Scroll-To-Latest Slot

`renderScrollToLatest` 应直接接收 loaded context：

```ts
type ScrollToLatestSlotInput = {
  visibleByScroll: boolean;
  loadedContext: MessageListLoadedContext;
  scrollToLatest: () => void;
};
```

`visibleByScroll` 仍然只是滚动侧阈值信号，不包含未读数、宿主策略或 loaded context。宿主自行组合最终展示策略：

```ts
const showScrollToLatest =
  loadedContext !== 'latest' || visibleByScroll || unreadCount > 0;
```

XMessageList 不拥有 unread count，也不内建 new-message banner。

## Tail API

remote append 只在 latest context 下有效：

```ts
if (session.getState().loaded.context === 'latest') {
  session.tail.remote.append({ rows, follow: 'auto' });
} else {
  hostStore.recordTailDirty(feedId, rows);
}
```

如果 `loaded.context` 是 `history` 或 `around` 时调用了 `tail.remote.append`，XMessageList 应发出 warning diagnostic，并保持 loaded rows 不变。

local stage 不同，因为它由当前 renderer 主动发起。用户在 `history` 或 `around` 中发送或 retry 时，可以在宿主提供 latest page 的情况下进入最新消息区间：

```ts
session.tail.local.stage({
  rows: [optimisticRow],
  latest: latestPageFromHostStore,
  reason: 'send',
});
```

`latest` 是 baseline latest page，不需要包含本次 staged optimistic row。XMessageList 应用 latest baseline、应用 `retireKeys`、追加 staged local rows、进入 latest context，并执行 send-style follow-bottom 行为。

当 `loaded.context !== 'latest'` 时，`tail.local.stage` 缺少 `latest` 是 integration error，不应修改 loaded rows。

重复检测由宿主 canonical store 负责。latest baseline 不应按 stable row key 与 staged rows 重复。

## Row 身份与 Mutation

row 使用 stable row key；它不要求等于 server message id。本地消息可以在服务端确认后保持同一个 row key：

```text
local send:
  stable row key = client-generated key
  serverId = undefined

server push confirms:
  same stable row key
  serverId = real server id
  rows.mutate({ patches, invalidateKeys })
```

XMessageList 不匹配 server push 和 local optimistic row。local id、client echo data 和 server id 的关联由宿主 canonical store 负责。

普通 edit、delete、reaction、read marker、media update、streaming patch 和相邻分组变化使用 `rows.mutate`。如果目标 row 不在 loaded segment，宿主只记录 canonical dirty state，并让未来 request 返回更新后的 row。

删除 mutation 会在 XMessageList 内部按删除前 segment 生成显式 remove modifier。
Host 不传 index，也不猜相邻 position；runtime 先选择被删锚点的存活 successor，
无 successor 才选择 predecessor，并仅失效首个删除位置开始的 suffix metric。

Host 无法用局部 mutation 证明当前窗口结构正确时调用
`session.commands.reloadCurrent({ reason: 'structural' })`。请求期间保留旧 rows，且只在
返回 `applied` 后按对应 host dirty revision 条件清理。around 目标已删除时，page 必须
用 `anchorStatus:'deleted'` 和 `anchor.fallbackStableId` 明确给出 successor-first 的
fallback；XMessageList 不从 message id 推断服务端顺序。

日期和未读标记是宿主渲染在普通 message row 内部的 title slot。XMessageList 不把它们建模为 row kind。它们影响布局时，宿主必须 bump row version 或传入 `invalidateKeys`。

system message 是稳定 row kind，但在本接入模型中不是 jump target。它的 `getAnchor` 返回 `null`。

## Jump Target

当宿主已知目标消息已删除或无权限时，该消息不是合法 jump target。宿主应在调用 `scrollToMessage` 或打开 around request 前阻止。

如果宿主只能在 `loadAround` 期间发现问题，业务分类由宿主 error shape 承载。XMessageList 只进入 request failure / overlay failure 状态，不拥有产品文案。

`anchorMemory` restore 不是用户目标跳转。它进入 `history`，不是 `around`。

## Read Receipts 与 Observation

read receipts 只由 mounted viewport observation 触发。加载、prefetch、cached session 和后台同步本身都不会 mark read。

`adapter.readReceipts.shouldMarkRead(row)` 只做 row-level 过滤。窗口焦点、账号策略、active-session 策略和跨设备已读状态留在宿主实现中。

`onViewportObservationChange` 用于 diagnostics、analytics、evidence 或 visible-range UI。它不是 read receipt 主路径。

## 生命周期与多窗口行为

每个 Electron renderer window 拥有自己的 `MessageListSessionRegistry`。registry 和 viewport runtime 不跨窗口共享，因为 DOM refs、measurement、motion 和 viewport observation 都是 window-local。

宿主 canonical stores 可以跨窗口同步。

`anchorMemory` 按 session identity 保存，因此同一个 feed 在多窗口下默认 last-write-wins。如果未来需要每个窗口独立阅读状态，宿主必须调整 `sessionId` 模型，而不是给 anchor memory 暗中增加私有 scope。

feed 切换时，可见 UI 应立即进入目标 session shell。旧 session 不应继续作为 loading placeholder 显示。warm entry 可以用 `retainSession(feedId, 'prefetch')`，但 prefetch 只用于高概率进入的 UI 工作流，不用于后台同步。

## Diagnostics

public contract violation 应有稳定 diagnostic name。建议名称：

```text
page.latestHasMoreAfter
page.reachedLatestHasMoreAfter
remoteTailAppend.outsideLatestContext
localTailStage.missingLatest
localTailStage.duplicateRowKey
aroundReachedLatestIgnored
requestTrigger.invalidViewportUse
```

会破坏 loaded context 或 latest page 语义的违规应使用 error-level diagnostic。被忽略的 append、around context 中被忽略的 `reachedLatest` metadata 等路径适合 warning-level diagnostic。

## 实现待办

- 增加 `state.loaded.context`。
- 增加 `MessageListPage.reachedLatest`。
- 增加 `MessageListRequestTrigger` 和 `requestContext.trigger`。
- 在 `MessageListRequestResult` 中增加 `trigger`。
- 向 `renderScrollToLatest` 传入 `loadedContext`。
- 校验 latest page 必须 `hasMoreAfter=false`。
- 校验 remote append 只在 latest context 下有效。
- 校验非 latest context 下 local stage 必须提供 latest page。
- 增加上述 contract violation 的稳定 diagnostics。
