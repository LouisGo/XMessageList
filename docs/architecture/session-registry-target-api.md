# Session Registry 目标架构与 API 调整方案

本文档描述 `MessageListSessionRegistry` 的目标架构和 public API 心智模型。
当前实现使用 canonical registry 命名，不保留 deprecated 兼容别名。

## 背景与结论

当前实现中，真正的消息列表实例是 `MessageListSession`。每个 session 独立持有
viewport runtime、loaded segment store、loaded segment、edge state、overlay、
`anchorMemory`、`readReceipts` 和 tail event 语义。Registry 的核心职责是按 id
创建、缓存、复用和销毁 session，并把 host 提供的 adapter、默认配置和 keepAlive
策略注入 session。

因此，目标架构不剥离这层生命周期容器。`registry` 表达的是 `sessionId` identity 与
lifecycle registry/cache/factory，不是业务层的消息管理器，也不是 React adapter
的 owner。

借鉴 TanStack Query 的 API 哲学时，应借鉴 identity 和 lifecycle 模型，而不是照搬
`query` 命名：

- `queryKey` 的对应物是 `sessionId`。
- `QueryClient` 的对应物是 `MessageListSessionRegistry`。
- `useQuery` 的对应物不是一个新的 fetch hook，而是
  `registry.getSession(sessionId)` 与 `<MessageList session={session} />`。

## 核心心智

```text
MessageListSessionRegistry
  owns sessionId identity, lazy creation, reuse, keepAlive and destruction

MessageListSession
  owns one session-backed message-list instance

React Adapter
  projects an existing session into <MessageList />

Viewport Runtime + Loaded Segment Store
  remain package-internal engines owned by each session
```

`MessageListSession` 是最小可渲染消息列表实例。chat、thread、AI sidebar、收藏夹
都应该表达为一个 session。差异来自 host 如何为该 `sessionId` 选择 adapter、
request route、anchor memory 和 read receipt 行为，而不是来自 React 或 runtime
额外分支。

## Session Identity

目标 public 术语统一使用 `sessionId`。在 TypeX Electron 业务里，host 的
`feed_id` 可以保证全局唯一，因此 host 可以直接把 `feed_id` 映射为
`sessionId`：

```ts
const session = registry.getSession(sessionId)
```

runtime、segment、anchor、viewport events、request context、request result、
remote append context 和 session state 都使用 `sessionId` 表达列表身份，不提供 `id` alias；
host 的 feed identifier 只存在于 host adapter / `getSessionSource(sessionId)` 返回值中，
不进入 XMessageList identity anchor。
`MessageListSessionSource` 可以在简单接入中回退为 `sessionId`，但这是 fallback，
不是概念合并：`sessionId` 表达 XMessageList session identity，source 表达 host
选择 adapter、request route、anchor memory 和 read receipt 行为所需的来源身份。

这个约定覆盖以下场景：

- 分屏同时展示两个 chat 消息列表：两个不同 `feed_id`，两个独立 session。
- 同时展示 chat 与 thread：thread 本质仍是另一条 feed，用自己的 `feed_id`。
- 同时展示 chat 与侧边栏 AI 消息列表：AI 列表也有自己的 `feed_id`。
- 收藏夹或其他固定列表：使用固定且全局唯一的 `feed_id` 或固定 `sessionId`。

如果未来出现同一个 host feed 需要同时承载两个独立滚动状态或不同 loaded segment
语义的场景，必须扩展 `sessionId`，例如加入 view scope 或 list kind。只要
host feed identifier 继续保持全局唯一且一条 host feed 只对应一个 session 状态，
就可以直接把它映射为 `sessionId`。

## Registry Ownership And Lifecycle

`MessageListSessionRegistry` 应由 app host 持有，通常是一个 renderer window 或一个
消息域 provider 下的稳定单例。它不能在 React render 中重复创建；如果需要接入
React，应在 app bootstrap、root store、dependency container 或稳定 memo 中创建。

目标生命周期规则：

- host 创建 registry，并在 window teardown、账号退出、workspace 切换或消息域卸载时
  调用 `registry.destroyAll()`。
- React adapter 在 `<MessageList />` mount 时自动 retain 对应 session，unmount 时
  release；mounted session 不参与 LRU 淘汰。
- `getSession(sessionId)` 只保证同步 lazy create / reuse session；它不启动
  bootstrap request、timer 或 runtime transaction。数据加载从 mounted retain、
  host retain 或显式 command/retry/reload 语义开始。
- host 可以通过 `registry.retainSession(sessionId, reason)` 保留一个未挂载但仍处于
  业务活跃状态的 session，例如分屏预加载、悬浮窗口或即将切回的 session。
  reason 必须保持 session/workflow 语义，例如 `active-session`、`split-view` 或
  `prefetch`；不要把 host 的 feed/conversation vocabulary 写入 public retain reason。
  `retainSession(..., 'prefetch')` 会启动 session bootstrap，以便后续 warm enter。
- `registry.sweep()` 执行 TTL 清理；`getSession()` 和配置更新后可以自动触发一次
  sweep。
- `destroySession(sessionId)` 是显式销毁：取消 timers、释放 runtime 和 Loaded Segment Store、
  清空 read receipt worker 和 overlay 状态，并从 registry 删除。
- `maxSessions` 是缓存容量，不是活跃 session 数。它只约束 unmounted 且未被 host
  retain 的 cached sessions。
- 当前实现已经按 cached session 计数执行 LRU；mounted 或 host-retained session 不计入
  `maxSessions`，但仍可被显式 `destroySession(sessionId)` 销毁。

目标 registry surface：

```ts
type MessageListSessionRetainReason =
  | 'active-session'
  | 'split-view'
  | 'prefetch'

type MessageListSessionRegistry<Row, Source = MessageListSessionSource> = {
  getSession(sessionId: MessageListSessionId): MessageListSession<Row>
  hasSession(sessionId: MessageListSessionId): boolean
  destroySession(sessionId: MessageListSessionId): boolean
  destroyAll(): void
  getSessionIds(): MessageListSessionId[]
  getSessionMeta(sessionId: MessageListSessionId): MessageListSessionRegistryEntry | null
  retainSession(sessionId: MessageListSessionId, reason: MessageListSessionRetainReason): () => void
  updateOptions(options: MessageListSessionRegistryOptionsPatch<Row, Source>): void
  sweep(): void
}
```

`MessageListSessionRegistryEntry` 至少应表达 `sessionId`、`createdAt`、
`lastUsedAt`、`mountedRetainCount`、`hostRetainCount` 和 `status`。
`status` 推荐为 `mounted | active | cached`：mounted 表示存在 React view，active
表示 host 仍认为该 session 业务活跃，cached 表示仅为快速恢复保留。

## Configuration Updates

registry 需要支持配置更新，但不是所有配置都应该原地影响已有 session。

可动态更新并影响已有 session 的配置：

- `pageSize`：影响后续 latest/before/after/around request，不重写已经 loaded 的
  segment。
- `keepAlive.maxSessions` / `keepAlive.ttlMs`：立即影响后续 sweep 和 LRU 淘汰。
- `scrollMotion.enabled`：后续 scroll command 和 runtime motion 决策读取新策略。
- `tailEvents.getPageFocus` / `tailEvents.shouldFollowRemoteAppend`：后续
  `tail.remote.append` 决策读取新策略。
- `onRequestResult`：后续 request result 使用新 callback。

不建议原地更新已有 session 的配置：

- `retention`：这是 Message List Retention tier，会影响 session 内部
  Loaded Segment Store 的 trim strategy；它不是精确 row budget，也不恢复
  `maxItems` public API。改动后应销毁并重建 session，或由未来明确的 retention
  resize API 处理。
- `getSessionSource` / `getAdapter` 对已有 session 的结果：session source、row adapter、
  request route、anchor memory 和 read receipts 是 `sessionId` identity 的一部分。
  如果这些语义变化，应 `destroySession(sessionId)` 后重新 `getSession(sessionId)`。

`updateOptions` 只接受动态配置 patch，不接受 `retention`、`getSessionSource` 或 `getAdapter`。
需要改变静态语义时，host 必须显式销毁相关 session，避免一个 session 在生命周期中
悄悄换 source、adapter、anchor memory 或 read receipts。

## Public API 目标形态

package 根出口目标命名：

```ts
export {
  createMessageListSessionRegistry,
  MessageListSessionRegistryProvider,
  useMessageListSession,
  useMessageListState,
  MessageList,
}

export type {
  MessageListAdapter,
  MessageListAnchor,
  MessageListAnchorMemoryValue,
  MessageListDestinationCancelInput,
  MessageListDestinationCancelResult,
  MessageListDestinationDispatchResult,
  MessageListDestinationState,
  MessageListSessionId,
  MessageListSessionSource,
  MessageListSegmentRetention,
  MessageListIdentityRemap,
  MessageListLocalTailStageInput,
  MessageListRemoteTailAppendContext,
  MessageListRemoteTailAppendInput,
  MessageListRemoteTailAppendPolicy,
  MessageListTailAppendFollowDecision,
  MessageListTailAppendFollowInput,
  MessageListPage,
  MessageListRequestContext,
  MessageListRequestResult,
  MessageListResolvedAnchor,
  MessageListRowsMutation,
  MessageListRowsReplaceInput,
  MessageListRowsResetAroundInput,
	  MessageListScrollMotionConfig,
	  MessageListScrollToMessageOptions,
	  MessageListSession,
	  MessageListSessionContext,
	  MessageListSessionRegistry,
	  MessageListSessionRegistryEntry,
	  MessageListSessionRegistryOptions,
	  MessageListSessionRegistryOptionsPatch,
	  MessageListSessionRetainReason,
	  MessageListSessionState,
	  MessageListOverlayStatus,
	  EmptySlotInput,
  EdgeSlotInput,
  MessageListCommands,
  MessageListProps,
  MessageListRenderItem,
  MessageListRenderRowInput,
  MessageListStateEqualityFn,
  MessageListStateSelector,
  MessageListViewportAnchorChangeEvent,
  MessageListViewportObservationEvent,
  OverlayStatusInput,
  ScrollToLatestSlotInput,
}
```

对业务接入者可见的 id 不暗示它一定是 conversation。Public API 只保留
`MessageListSessionId`、`MessageListSessionSource`、`MessageListSessionRegistry`、
`MessageListSessionRegistryProvider` 和 `tail.local` / `tail.remote` 口径。

## Registry API

目标 registry 创建方式：

```ts
const registry = createMessageListSessionRegistry<Message, Source>({
  defaults: {
    pageSize: 32,
    retention: 'balanced',
    keepAlive: {
      maxSessions: 20,
      ttlMs: 10 * 60_000,
    },
  },
  scrollMotion: {
    enabled: () => deviceConfig.messageListMotionEnabled,
  },
  getSessionSource: (sessionId) => getSessionSourceById(sessionId),
  getAdapter: (source) => getAdapterForSource(source),
  tailEvents: {
    getPageFocus: () => document.hasFocus(),
    shouldFollowRemoteAppend: ({ pageFocused, bottomLockState, distanceToBottom }) =>
      pageFocused && (bottomLockState === 'LOCKED' || distanceToBottom <= 96),
  },
  onRequestResult: (result) => logMessageListRequest(result),
})
```

`getSessionSource` / `getAdapter` 是 session 创建时的 host dependency injection。
`SessionRegistry` 不拥有 host 的全量分页缓存、dirty timestamp、业务未读状态、
权限、免打扰或持久化；这些仍由 Electron app 的业务 store 负责。

## Session Contract

`MessageListSession<Row>` 继续是 React 渲染和业务操作的核心对象：

```ts
type MessageListSession<Row> = {
  sessionId: MessageListSessionId
  getState(): MessageListSessionState<Row>
  subscribe(listener: () => void): () => void

  commands: {
    prepare(options?: MessageListSessionPrepareOptions):
      Promise<MessageListSessionPrepareResult>
    scrollToLatest(): void
    scrollToMessage(
      anchor: MessageListAnchor,
      options?: MessageListScrollToMessageOptions,
    ): MessageListDestinationDispatchResult
    cancelDestination(input: {
      destinationId: string
      reason: 'superseded'
    }): MessageListDestinationCancelResult
    loadBefore(): void
    loadAfter(): void
    reloadLatest(): void
    reloadCurrent(options: {
      reason: 'structural'
    }): Promise<MessageListReloadCurrentResult<Row>>
  }

  rows: {
    patch(rows: Row[]): void
    mutate(input: MessageListRowsMutation<Row>): void
    replace(input: MessageListRowsReplaceInput<Row>): void
    resetLatest(page: MessageListPage<Row>): void
    resetAround(input: MessageListRowsResetAroundInput<Row>): void
    applyIdentityRemap(remaps: MessageListIdentityRemap[]): void
    clear(): void
  }

  tail: {
    local: {
      stage(input: Row | Row[] | MessageListLocalTailStageInput<Row>): void
      patch(rows: Row[]): void
      applyIdentityRemap(remaps: MessageListIdentityRemap[]): void
    }
    remote: {
      append(input: Row | Row[] | MessageListRemoteTailAppendInput<Row>): void
    }
  }
}
```

`prepare` 只准备 Session 数据，不构造第二个 React view。无 target 时共享首次
bootstrap；有 target 时发布 around segment。其 `ready` 不是视觉完成信号，DOM attach、
anchor correction 和 destination settle 仍属于随后挂载的唯一 active view。

`scrollToMessage` 是单个 session 内的同步 destination dispatch，不是跨 session
导航命令。每次受理都会生成新的 `destinationId`，即使目标与上一次完全相同；调用方
通过 `getState().destination` 与 `subscribe` 观察该次命令的
`pending -> settled | cancelled | failed` 生命周期。目标已在本地窗口内时也遵循同一
生命周期。未挂载 session 可以先请求 around window，但只有视图挂载并完成对齐后才
进入 `settled`。

`settled` 的 `resolution` 区分 `target` 与 `fallback`。后者表示 host 返回了合法替代
锚点，仍是成功终态；request failure、page contract violation 和 projection commit
timeout 则进入 `failed`。新命令会先把旧命令发布为 `cancelled/superseded`，用户滚动
和 session 销毁分别发布 `user-interrupt` 与 `session-destroyed`。命令完成不返回
Promise，异步结果只能从 session 公共状态观察。

Host 需要取代已受理但尚未完成的定位时，调用
`cancelDestination({ destinationId, reason: 'superseded' })`。命令只在 id 与当前
pending destination 完全匹配时取消底层 runtime intent、作废对应 around request，
并发布 `cancelled/superseded`；迟到 id 返回 `ignored/not-current`，Session 销毁后返回
`ignored/session-destroyed`。该能力防止未挂载 Session 日后执行过期定位，但不理解或
存储 host 的路由、栏位和应用导航事务。

Registry 只提供 session 的查询、创建、保留和销毁能力。选择目标 session、切换路由、
打开主栏或侧栏以及维护应用级导航事务，均属于 host；XMessageList 不提供
`jumpToSession` 一类应用命令。

`reloadCurrent` 是 host structural dirty 的对账命令，不是用户 jump 的别名：真实
latest 且 locked 时请求 latest；其余状态捕获第一条可见消息 identity 与
`offsetWithinMessage`，静默请求 around 并按 start 恢复。旧 rows 保留到新 page 的
projection transaction 完整 settle。只有返回 `status:'applied'` 才表示 DOM 已提交、
测量和唯一一次 correction 已完成；`stale` / `failed` 不允许 host 清 structural dirty。

`commands` 表示视口或请求意图。`rows`、`tail.local` 和 `tail.remote.append`
是不可互换的三类 row 变化入口；`rows` 表示 loaded segment 内普通 row 变更。
`tail.local` 表示本 renderer 发起的 send/retry optimistic tail 语义；
`tail.remote.append` 表示远端、服务端、SDK 或 main process 推送的 tail 新消息，
并携带 follow/preserve 策略进入 runtime transaction。`local` / `remote` 表达的是
事件来源，不是消息作者；其他端发送后同步回本端的 self-authored message 仍然走
`tail.remote.append`。
普通 edit、delete、reaction、read marker、media update 和 streaming patch 应翻译成
`rows.mutate(...)`，不能借用 tail 语义。
`rows.clear()` 是 Session History Clear：当前 session 的历史聊天记录被清空，但 session
仍保留，之后可以继续通过 `tail.local` 发送、通过 `tail.remote.append` 接收。host
业务清空应先更新 Host Message Event Store / canonical store，再把 active session 翻译成
`rows.clear()` 或 `rows.resetLatest(emptyPage)`；只有 session identity 或 static semantics
作废时才使用 `destroySession(sessionId)`。
clear 后 `hasMoreBefore` / `hasMoreAfter` 为 false，不再触发加载更多历史；如果 host
仍认为有历史可拉，应使用 reload 或 `rows.resetLatest(page)` 重建窗口，而不是
`rows.clear()`。
clear 后旧 `anchorMemory` 必须由 Host Message Event Store / host persistence 失效化，
或在后续 `anchorMemory.load` 返回 `null`；`rows.clear()` 不直接清 host 持久化。
clear 本身不产生 read receipts；旧历史的已读/未读状态以 host canonical store 为准。
后续只有 mounted viewport observation 看到新 rows 时，session read receipt worker 才会
调用 `readReceipts.markRead`。

这些入口仍然保持 session 级隔离：不同 `sessionId` 下的 DOM 测量、scroll
correction、edge request、overlay、anchor memory 和 read receipt worker 互不共享。

## React API

React 目标模型保持显式 session 渲染：

```tsx
function ConversationPane({ sessionId }: { sessionId: string }) {
  const session = useMessageListSession<Message>(sessionId)

  return (
    <MessageList
      session={session}
      renderRow={({ row }) => <MessageRow message={row} />}
    />
  )
}
```

Provider 只提供 registry：

```tsx
<MessageListSessionRegistryProvider registry={registry}>
  <ConversationPane sessionId={activeFeedId} />
</MessageListSessionRegistryProvider>
```

`MessageList` 接收的是已经存在的 session；React adapter 不创建 runtime、不发 request、
不合并数据、不持久化 anchor、不运行 read receipts。
React adapter 也不接 SDK、main process 或 bridge callbacks；这些 callbacks 只能先进入
Host Message Event Store，再由 host 翻译成 session-level public API。
因此核心 `MessageList` 不提供 `data` / `rows` prop。需要把全量数组接入为可滚动
窗口时，应在外层 wrapper/helper 中创建 registry、session 和 array-backed adapter，
再把 session 交给核心组件。

如果 host 已经直接持有 session，也可以绕过 provider：

```tsx
<MessageList session={session} renderRow={renderRow} />
```

## Activation And Event Fanout

registry 需要有 session 状态，但不应该变成全局消息事件总线。SDK、main process
或 bridge 的 message callbacks 先进入 host-owned Host Message Event Store，
再由 host 翻译成 session-level public API。推荐分工是：

- app host 的 Host Message Event Store 接收 Electron/main/SDK 推送，负责 canonical
  cache、dirty timestamp、未读计数和跨列表业务策略。
- registry 只管理已经创建的 session 生命周期，不主动为所有 cached session 订阅
  重型 push stream。
- mounted 或 host-retained active session 可以接收即时视觉更新：host 将推送翻译成
  `session.tail.remote.append(...)`、`session.rows.mutate(...)` 或
  `session.tail.local.patch(...)`。
- cached session 默认不处理重型事件。host 只更新业务 store，并标记该 feed dirty；
  下次 session 激活、mount 或 reload 时再通过 request/dirty check 恢复。
- read receipts 只来自 viewport observation；没有 mounted view 的 session 不会产生
  新 observation，也不应该主动 mark read。
- `anchorMemory` load/save 由 session 在 restore/settle 语义下调用 host adapter；
  Host Message Event Store 和 React adapter 不直接持久化 anchor。
- edge paging 只由 mounted viewport runtime 的 semantic need events 触发；
  latest/around restore 可以由 session activation、mount、reload 或显式 command 触发。
  cached session 不应因为后台 push/update 或 host background sync 自动分页；host 只更新
  canonical store 和 dirty state。

`maxSessions: 20` 的含义是最多保留 20 个 session 状态用于快速恢复，不表示 20 个
session 都处于活跃计算状态。通常 Electron 同时 mounted 的 session 只有 1 到 2 个；
其余 cached session 只保留轻量内存状态，并可被 TTL 或 LRU 淘汰。

## 多实例与隔离规则

Electron 应用可以同时展示多个 message list。只要每个列表使用不同 `sessionId`
或全局唯一 `feed_id`，现有 session 边界天然支持隔离：

- 每个 session 有独立 viewport runtime 和 scroll container ownership。
- 每个 session 有独立 loaded segment store、request token、segment revision 和 trim。
- 每个 session 有独立 overlay loading/error 状态。
- 每个 session 有独立 `anchorMemory` load/save 上下文。
- 每个 session 有独立 read receipt batching worker。
- React 多个 `<MessageList />` 只是投影不同 session，不共享 DOM refs。

需要避免的是让同一个 `sessionId` 同时表达两个语义不同的列表。如果两个列表必须有
独立滚动状态、独立 loaded segment 或不同 request/adapter 语义，它们必须使用不同
`sessionId`。

## 命名状态

当前 public docs、demo 和测试样板使用 `registry` / `sessionId` 口径。
Runtime 和 Loaded Segment Store 仍然不进入 package root public surface；React adapter 仍通过
package-internal session internals 访问 runtime/view store。

## 非目标

- 不把 XMessageList 改成通用虚拟列表。
- 不把 `MessageListSessionRegistry` 变成业务 feed store。
- 不让 React 直接拥有 request、merge、anchor persistence 或 read receipts。
- 不暴露 runtime snapshot、runtime event、loaded segment 或 loaded segment store 类型给业务。
- 不为了重命名改变 loaded segment native scroll、anchor correction 或 edge latch
  语义。
