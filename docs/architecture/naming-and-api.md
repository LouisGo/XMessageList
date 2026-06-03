# 术语与 Public API 命名

本文档是当前实现的命名基准。用户会 import、配置或在业务代码中直接看到
的名字，统一使用 `MessageList` / `MessageListSession` / `MessageListManager`。
`controller` 只允许出现在 runtime 内部实现名中，例如
`MessageListRuntimeController`。

## 核心心智

```text
MessageListManager 管理多个 MessageListSession
MessageListSession 代表一个 conversation 的消息列表会话实例
React 只负责把 session 渲染成 <MessageList />
Runtime 是 framework-independent 内部引擎
```

## Public Export

package 根出口只暴露应用接入所需的 message-list surface：

```ts
export {
  createMessageListManager,
  MessageListProvider,
  useMessageListSession,
  useMessageListState,
  MessageList,
}

export type {
  MessageListAdapter,
  MessageListAnchor,
  MessageListAnchorMemoryValue,
  MessageListConversationId,
  MessageListIdentityRemap,
  MessageListIncomingAppendContext,
  MessageListIncomingAppendFollowDecision,
  MessageListIncomingAppendFollowInput,
  MessageListIncomingAppendInput,
  MessageListIncomingAppendPolicy,
  MessageListManager,
  MessageListManagerOptions,
  MessageListOverlayStatus,
  MessageListOutgoingStageInput,
  MessageListPage,
  MessageListRequestContext,
  MessageListRequestResult,
  MessageListResolvedAnchor,
  MessageListRowsMutation,
  MessageListRowsReplaceInput,
  MessageListRowsResetAroundInput,
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

根出口不导出 runtime/data runtime implementation：

- 不导出 `createMessageListRuntime`。
- 不导出 `MessageListRuntime`。
- 不导出 `MessageListSnapshot` / `MessageListRuntimeEvent`。
- 不导出 `LoadedSegment` / `MessageDataItem`。
- 不提供 `x-message-list/data` 子路径。
- 不承诺内部目录 deep import；业务代码只依赖 package exports。

## Manager API

```ts
const manager = createMessageListManager({
  defaults: {
    pageSize: 30,
    maxItems: 300,
    keepAlive: {
      maxSessions: 20,
      ttlMs: 10 * 60_000,
    },
  },
  getConversation: (id) => getConversationById(id),
  getAdapter: (conversation) => normalMessageAdapter,
  incoming: {
    getPageFocus: () => document.hasFocus(),
    shouldFollowAppend: ({ pageFocused, bottomLockState, distanceToBottom }) =>
      pageFocused && (bottomLockState === 'LOCKED' || distanceToBottom <= 96),
  },
})

manager.getSession(id)
manager.hasSession(id)
manager.destroySession(id)
manager.destroyAll()
```

使用 `getConversation/getAdapter`，不用 `resolveConversation/resolveAdapter`，
因为这里是应用级依赖注入，不是每次 render 的动态解析配置。
`incoming.shouldFollowAppend` 是 receive append 的应用级策略入口；XMessageList
提供当前滚动距离、bottom lock、pending intent 和页面焦点等上下文，但不替业务
定义未读、免打扰或后台标签页策略。

## Adapter Contract

```ts
type MessageListAdapter<Row, Conversation> = {
  row: {
    getKey(row: Row): string
    getAnchor(row: Row): MessageListAnchor | null
    getVersion?(row: Row): unknown
    getKind?(row: Row): string
  }

  request: {
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

- 使用 `request`，不使用 `data`，因为这里放的是外部异步依赖。
- 使用 `anchorMemory`，不使用 `memory`，避免误解成通用缓存。
- 使用 `readReceipts`，不使用 `readReceipt`，表达这是已读能力组。

## React API

Canonical names：

| 名称 | 类别 | 说明 |
| --- | --- | --- |
| `MessageList` | React component | 唯一公开组件名 |
| `MessageListProvider` | React component | 注入应用级 manager |
| `useMessageListSession` | hook | 按 conversation id 解析 session |
| `useMessageListState` | hook | 订阅 session 级只读列表状态 |
| `MessageListSession` | public object | conversation 的消息列表会话实例 |
| `MessageListProps` | React props | 组件 props 类型 |

```tsx
const session = useMessageListSession<Message>(conversationId)

return (
  <MessageList
    session={session}
    renderRow={({ row }) => <MessageRow message={row} />}
    renderBeforeStatus={({ status, retry }) => ...}
    renderAfterStatus={({ status, retry }) => ...}
    renderTopPlaceholder={() => ...}
    renderOverlayStatus={({ status }) => ...}
    renderEmpty={({ reload }) => ...}
    renderScrollToLatest={({ visible, scrollToLatest }) => ...}
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

## Session Shape

Public `MessageListSession<Row>` 只暴露使用方需要的能力：

```ts
type MessageListSession<Row> = {
  id: string
  getState(): MessageListSessionState<Row>
  subscribe(listener): () => void

  commands: {
    scrollToLatest(): void
    scrollToMessage(anchor, options?): void
    loadBefore(): void
    loadAfter(): void
    reloadLatest(): void
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

  outgoing: {
    stage(input): void
    patch(rows): void
    applyIdentityRemap(remaps): void
  }

  incoming: {
    append(input): void
  }
}
```

```ts
type MessageListOutgoingStageInput<Row> = {
  rows: Row[]
  latest?: MessageListPage<Row>
  reason?: 'send' | 'retry'
  retireKeys?: string[]
}
```

`commands` 表示视口/请求意图；`rows` 表示普通 row 变更入口，用于 edit、
delete、reaction、read marker、media loaded、streaming patch、replace、clear
等不带“新尾部消息”语义的场景。推荐普通服务端 update 推送统一翻译成
`rows.mutate({ patches, removeKeys, invalidateKeys, reason })`：`patches` 只更新
当前 loaded segment 内已存在的 row，`removeKeys` 原子删除 loaded row，
`invalidateKeys` 只 bump row render version，用于相邻分组、日期分割、read marker
或绝对序号等上下文渲染依赖。未加载页的脏检查、分页缓存和持久化继续由外部业务
store 负责。

`getState` / `subscribe` 是 session 级只读 store；React 侧使用
`useMessageListState(session, selector, equality?)` 做 selector 订阅。state 暴露
loaded rows/keys、edge status、overlay status 和 viewport bottom/pending/phase
等稳定列表概念，不暴露 runtime snapshot、loaded segment 或 DOM evidence。

`outgoing` 表示本人 send/retry 的 optimistic outgoing 语义：调用方发布本地 row，
session 负责进入 latest 目标、合入 pending outgoing、处理后续 patch/remap。
`stage` 始终是 send-style follow-bottom；retry 成功若要作为“重新发送”处理，也应该
等同一次 send。接入方可以传入 `retireKeys`，让旧 failed/retrying 占位和新
outgoing row 在同一次 append 事务里完成，避免先 delete 再 send 造成视图状态竞争。
当 `stage` 同时携带 `latest` 时，含义是接入方已经提供了要显示的 latest window；
session 会用这个 window 做本地 latest rebuild 并继承 send-style follow-bottom，
不会再额外触发 `loadLatest` 或 runtime 的普通 latest request。`retireKeys` 对
这条 rebuild 路径同样生效，旧占位必须在 reset latest 和 pending outgoing 合并前
被过滤掉。

如果接入方把 retry 设计成重新发送，应创建新的业务 row，并把 retry 的业务等待拆成
两段：先把旧 failed 占位原地 patch 为 retrying/loading，不触发 follow-bottom；
异步成功后再发布新的 outgoing row，同时用 `retireKeys` 原子移除或归档旧占位。
不要对旧 row 原地 patch 为 sending 后再触发 follow-bottom。

`incoming.append` 表示他人或服务端在 latest tail 到达的新消息。它不同于普通
`rows.patch`：append 会携带 follow/preserve 决策进入 runtime modifier，允许
接入方按 `distanceToBottom`、`pageFocused`、未读策略或会话状态决定是否跟随。
如果用户已经显式点击 bottom，本次 bottom intent 优先于并发 append 的旧
preserve 决策；但已经 settled 的 bottom lock 不会强行覆盖接入方显式
`preserve`。
非 latest segment 下不会把新消息强插入历史窗口。

React adapter 需要的 runtime/view store/row lookup 通过 package-internal helper
访问，不进入 public type。
