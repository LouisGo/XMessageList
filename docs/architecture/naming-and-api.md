# 术语与 Public API 命名

本文档是当前实现的命名基准。用户会 import、配置或在业务代码中直接看到
的首选名字，统一使用 `MessageList` / `MessageListSession` /
`MessageListSessionRegistry`。开发期不保留 deprecated 兼容别名。
`controller` 只允许出现在 runtime 内部实现名中，例如
`MessageListRuntimeController`。

## 核心心智

```text
MessageListSessionRegistry 管理多个 MessageListSession
MessageListSession 代表一个 sessionId 对应的消息列表会话实例
React 只负责把 session 渲染成 <MessageList />
Runtime 是 framework-independent 内部引擎
```

## Public Export

package 根出口只暴露应用接入所需的 message-list surface：

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
  MessageListInitialWindow,
  MessageListSessionId,
  MessageListSessionSource,
  MessageListSegmentRetention,
  MessageListSessionRegistry,
  MessageListSessionRegistryEntry,
  MessageListSessionRegistryOptions,
  MessageListSessionRegistryOptionsPatch,
  MessageListSessionRetainReason,
  MessageListIdentityRemap,
  MessageListLocalTailStageInput,
  MessageListRemoteTailAppendContext,
  MessageListRemoteTailAppendInput,
  MessageListRemoteTailAppendPolicy,
  MessageListTailAppendFollowDecision,
  MessageListTailAppendFollowInput,
  MessageListOverlayStatus,
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
  MessageListSessionState,
  EmptySlotInput,
  EdgeSlotInput,
  MessageListCommands,
  MessageListRenderItem,
  MessageListProps,
  MessageListRenderRowInput,
  MessageListStateEqualityFn,
  MessageListStateSelector,
  MessageListViewportAnchorChangeEvent,
  MessageListViewportObservationEvent,
  OverlayStatusInput,
  ScrollToLatestSlotInput,
}
```

根出口不导出 runtime 或 Loaded Segment Store implementation：

- 不导出 `createMessageListRuntime`。
- 不导出 `MessageListRuntime`。
- 不导出 `MessageListSnapshot` / `MessageListRuntimeEvent`。
- 不导出 `LoadedSegment` / `MessageDataItem`。
- 不导出 `HostMessageEventStore`；Host Message Event Store 是 host 边界术语，
  不是 XMessageList package contract。
- 不提供 `x-message-list/data` 子路径。
- 不承诺内部目录 deep import；业务代码只依赖 package exports。

## Registry API

```ts
const registry = createMessageListSessionRegistry({
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
  getAdapter: (source) => normalMessageAdapter,
  tailEvents: {
    getPageFocus: () => document.hasFocus(),
    shouldFollowRemoteAppend: ({ pageFocused, bottomLockState, distanceToBottom }) =>
      pageFocused && (bottomLockState === 'LOCKED' || distanceToBottom <= 96),
  },
})

registry.getSession(sessionId)
registry.hasSession(sessionId)
registry.getSessionMeta(sessionId)
registry.retainSession(sessionId, 'active-session')
registry.destroySession(sessionId)
registry.destroyAll()
```

`retention` 是 host-facing Message List Retention tier，不是精确 row budget；
public API 不提供 `maxItems`。具体 trim budget 和 protected runway 属于 session
内部 Loaded Segment Store 策略。

使用 `getSessionSource/getAdapter`，不用 `resolveSource/resolveAdapter`，
因为这里是应用级依赖注入，不是每次 render 的动态解析配置。
`getSessionSource` / `getAdapter` 对已创建 session 的结果属于 Session Static
Semantics；如果 source、adapter、request route、anchorMemory 或 readReceipts 的语义
需要变化，host 应 `destroySession(sessionId)` 后重新创建，不通过 `updateOptions`
或重新解析 resolver 偷换。
`MessageListSessionSource` 默认可以回退为 `MessageListSessionId`，这是为无额外
source 模型的简单接入提供的 fallback；它不表示 source identity 在语义上永远等同
于 session identity。需要区分 host 数据源、列表种类或请求路由时，host 应显式提供
`getSessionSource(sessionId)`。
`retainSession(sessionId, reason)` 的 reason 使用 session/workflow 语义，例如
`active-session`、`split-view` 或 `prefetch`，不使用 `active-feed` /
`conversation-active` 这类 host vocabulary。React mount retain 由 React adapter
自动处理，不通过 public reason 表达。
`tailEvents.shouldFollowRemoteAppend` 是 remote tail append 的应用级策略入口；XMessageList
提供当前滚动距离、bottom lock、pending intent 和页面焦点等上下文，但不替业务
定义未读、免打扰或后台标签页策略。

## Adapter Contract

```ts
type MessageListAdapter<Row, Source> = {
  row: {
    getKey(row: Row): string
    getAnchor(row: Row): MessageListAnchor | null
    getVersion?(row: Row): unknown
    getKind?(row: Row): string
  }

  request: {
    loadInitial?(ctx): Promise<MessageListInitialWindow<Row>>
    loadLatest(ctx): Promise<MessageListPage<Row>>
    loadBefore(ctx): Promise<MessageListPage<Row>>
    loadAfter(ctx): Promise<MessageListPage<Row>>
    loadAround(ctx): Promise<MessageListPage<Row>>
  }

  anchorMemory?: {
    load(ctx): Promise<MessageListAnchorMemoryValue | null> | MessageListAnchorMemoryValue | null
    save(ctx, value: MessageListAnchorMemoryValue): void | Promise<void>
  }

  readReceipts?: {
    batchDelayMs?: number
    shouldMarkRead?(row: Row): boolean
    markRead(rows: Row[]): void | Promise<void>
  }
}
```

命名取舍：

- 使用 `request`，不使用 `data`，因为这里放的是 host-side async page loading
  dependency，不是 XMessageList 的 public data model。
- 使用可选 `loadInitial` 表达“首次进入时由宿主原子判定 latest/history”；它不是
  `loadLatest` 别名，并在提供时优先于 `anchorMemory.load`。
- 使用 `anchorMemory`，不使用 `memory`，避免误解成通用缓存。
- 使用 `readReceipts`，不使用 `readReceipt`，表达这是已读能力组。
`anchorMemory` 和 `readReceipts` 是 host-provided adapter capabilities：host 提供
持久化和 mark-read 实现，session 根据 restore/settle 或 mounted viewport observation
触发调用。React adapter 不持久化 anchor，也不运行 read receipt worker。

## React API

Canonical names：

| 名称 | 类别 | 说明 |
| --- | --- | --- |
| `MessageList` | React component | 唯一公开组件名 |
| `MessageListSessionRegistryProvider` | React component | 注入应用级 registry |
| `useMessageListSession` | hook | 按 `sessionId` 解析 session |
| `useMessageListState` | hook | 订阅 session 级只读列表状态 |
| `MessageListSession` | public object | session 的消息列表会话实例 |
| `MessageListProps` | React props | 组件 props 类型 |

```tsx
const session = useMessageListSession<Message>(sessionId)

return (
  <MessageList
    session={session}
    renderRow={({ row }) => <MessageRow message={row} />}
    renderBeforeStatus={({ status, retry }) => ...}
    renderAfterStatus={({ status, retry }) => ...}
    renderTopPlaceholder={() => ...}
    renderOverlayStatus={({ status }) => ...}
    renderEmpty={({ reload }) => ...}
    renderScrollToLatest={({ visibleByScroll, loadedContext, scrollToLatest }) => ...}
  />
)
```

`MessageListProps` 的 public surface：

```ts
type MessageListProps<TMessage = unknown> = {
  session: MessageListSession<TMessage>
  renderRow(input): ReactNode
  getRowRenderVersion?(item): unknown
  className?: string
  style?: CSSProperties
  renderBeforeStatus?(input): ReactNode
  renderAfterStatus?(input): ReactNode
  renderTopPlaceholder?(): ReactNode
  renderOverlayStatus?(input): ReactNode
  renderEmpty?(input): ReactNode
  renderScrollToLatest?(input): ReactNode
  onViewportAnchorChange?(event): void
  onViewportObservationChange?(event): void
  scrollbar?: 'native' | 'custom'
}
```

`MessageList` 保持 session-first：核心组件接收 `session`，不接收 `data` / `rows`
作为列表数据入口。全量数组或静态列表的轻量接入应通过 wrapper/helper 创建
registry、session 和 array-backed adapter，再把 session 交给核心组件渲染。

## Session Shape

Public `MessageListSession<Row>` 只暴露使用方需要的能力：

```ts
type MessageListSession<Row> = {
  sessionId: MessageListSessionId
  getState(): MessageListSessionState<Row>
  subscribe(listener): () => void

  commands: {
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
    mutate(input): void
    replace(input): void
    resetLatest(page): void
    resetAround(input): void
    applyIdentityRemap(remaps): void
    clear(): void
  }

  tail: {
    local: {
      stage(input): void
      patch(rows): void
      applyIdentityRemap(remaps): void
    }
    remote: {
      append(input): void
    }
  }
}
```

`scrollToMessage` 是同步 destination dispatch：每次受理都会返回新的
`destinationId`，异步完成状态通过 `getState().destination` 观察。
`cancelDestination` 只接受当前仍为 pending 且 id 匹配的 destination；成功时先停止
runtime intent 并作废对应 around request，再发布 `cancelled/superseded`。非当前 id
返回 `ignored/not-current`，销毁后的 Session 返回 `ignored/session-destroyed`，两者均
不改写公开状态。这个命令只取消单 Session 定位，不表达路由或应用导航事务。

```ts
type MessageListLocalTailStageInput<Row> = {
  rows: Row[]
  latest?: MessageListPage<Row>
  reason?: 'send' | 'retry'
  retireKeys?: string[]
}
```

`MessageListPage` 可携带 `reachedLatest?: boolean`，只用于 after page 证明历史窗口
抵达 latest 边界；`loadLatest`、`rows.resetLatest(page)` 和
`tail.local.stage({ latest })` 的 latest page 必须满足 `hasMoreAfter=false`。
`MessageListRequestContext` / `MessageListRequestResult` 携带结构化
`trigger: 'viewport' | 'command' | 'restore' | 'internal'`，`reason` 仅保留为
诊断细节。

`commands` 表示视口/请求意图；`rows`、`tail.local` 和 `tail.remote.append`
是不可互换的三类 row 变化入口。`rows` 表示普通 row 变更入口，用于 edit、
delete、reaction、read marker、media loaded、streaming patch、replace、clear
等不带“新尾部消息”语义的场景。推荐普通服务端 update 推送统一翻译成
`rows.mutate({ patches, removeKeys, invalidateKeys, reason })`：`patches` 只更新
当前 loaded segment 内已存在的 row，`removeKeys` 原子删除 loaded row，
`invalidateKeys` 只 bump row render version，用于相邻分组、日期分割、read marker
或绝对序号等上下文渲染依赖。未加载页的脏检查、分页缓存和持久化继续由外部业务
store 负责。
`rows.clear()` 表示当前 session 的历史聊天记录被清空，但 session 身份和收发能力仍然
存在；之后仍可继续通过 `tail.local` 发送、通过 `tail.remote.append` 接收新消息。
clear 后的 loaded segment 为空，`hasMoreBefore` / `hasMoreAfter` 都为 false，
不展示“可加载更多历史”；后续新消息从新的 tail 进入。
Host Message Event Store / host persistence 必须让该 session 的旧 `anchorMemory`
失效或返回 `null`；`rows.clear()` 只清当前 loaded segment，不清 host 持久化。
clear 本身不产生 read receipts；旧历史的已读/未读状态以 host canonical store 为准。
后续只有 mounted viewport observation 看到新 rows 时，session read receipt worker 才会
调用 `readReceipts.markRead`。
如果 host canonical store 返回一个空 latest page，也可以用 `rows.resetLatest(emptyPage)`
表达同一类清空后的窗口重建。销毁 session lifecycle 应使用 `destroySession(sessionId)`，
不要用 `rows.clear()` 表达。

`getState` / `subscribe` 是 session 级只读 store；React 侧使用
`useMessageListState(session, selector, equality?)` 做 selector 订阅。state 暴露
loaded rows/keys、edge status、overlay status 和 viewport bottom/pending/phase
等稳定列表概念，不暴露 runtime snapshot、loaded segment 或 DOM evidence。业务判断
必须基于这些 stable session state 或 host canonical store；runtime internals 只服务包内
transaction 和测试证据。

`tail.local` 表示本 renderer send/retry 的 optimistic tail 语义：调用方发布本地 row，
session 负责进入 latest 目标、合入 pending local tail、处理后续 patch/remap。
`stage` 始终是 send-style follow-bottom；retry 成功若要作为“重新发送”处理，也应该
等同一次 send。接入方可以传入 `retireKeys`，让旧 failed/retrying 占位和新
local tail row 在同一次 append 事务里完成，避免先 delete 再 send 造成视图状态竞争。
当 `stage` 同时携带 `latest` 时，含义是接入方已经提供了要显示的 latest window；
session 会用这个 window 做本地 latest rebuild 并继承 send-style follow-bottom，
不会再额外触发 `loadLatest` 或 runtime 的普通 latest request。`retireKeys` 对
这条 rebuild 路径同样生效，旧占位必须在 reset latest 和 pending local tail 合并前
被过滤掉。
当当前 `state.loaded.context !== 'latest'` 时，`stage` 必须携带 `latest` baseline；
缺失 baseline 属于 integration error，不会修改当前 rows。

如果接入方把 retry 设计成重新发送，应创建新的业务 row，并把 retry 的业务等待拆成
两段：先把旧 failed 占位原地 patch 为 retrying/loading，不触发 follow-bottom；
异步成功后再发布新的 local tail row，同时用 `retireKeys` 原子移除或归档旧占位。
不要对旧 row 原地 patch 为 sending 后再触发 follow-bottom。

`tail.remote.append` 表示远端、SDK、main process 或服务端在 latest tail 到达的新消息。它不同于普通
`rows.mutate`：append 会携带 follow/preserve 决策进入 runtime modifier，允许
接入方按 `distanceToBottom`、`pageFocused`、未读策略或会话状态决定是否跟随。
如果用户已经显式点击 bottom，本次 bottom intent 优先于并发 append 的旧
preserve 决策；但已经 settled 的 bottom lock 不会强行覆盖接入方显式
`preserve`。
非 latest segment 下不会把新消息强插入历史窗口。

React adapter 需要的 runtime/view store/row lookup 通过 package-internal helper
访问，不进入 public type。
