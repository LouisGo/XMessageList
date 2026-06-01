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
  MessageList,
}

export type {
  MessageListAdapter,
  MessageListAnchor,
  MessageListAnchorMemoryValue,
  MessageListConversationId,
  MessageListIdentityRemap,
  MessageListManager,
  MessageListManagerOptions,
  MessageListOverlayStatus,
  MessageListPage,
  MessageListRequestContext,
  MessageListRequestResult,
  MessageListResolvedAnchor,
  MessageListRowsReplaceInput,
  MessageListRowsResetAroundInput,
  MessageListScrollToMessageOptions,
  MessageListSession,
  MessageListSessionContext,
  EmptySlotInput,
  EdgeSlotInput,
  MessageListCommands,
  MessageListRenderItem,
  MessageListProps,
  MessageListRenderRowInput,
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
})

manager.getSession(id)
manager.hasSession(id)
manager.destroySession(id)
manager.destroyAll()
```

使用 `getConversation/getAdapter`，不用 `resolveConversation/resolveAdapter`，
因为这里是应用级依赖注入，不是每次 render 的动态解析配置。

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

  commands: {
    scrollToLatest(): void
    scrollToMessage(anchor, options?): void
    loadBefore(): void
    loadAfter(): void
    reloadLatest(): void
  }

  rows: {
    patch(rows: Row[]): void
    replace(input): void
    resetLatest(page): void
    resetAround(input): void
    applyIdentityRemap(remaps): void
    clear(): void
  }
}
```

`commands` 表示视口/请求意图；`rows` 表示本地 row 变更入口，用于 send、
append、edit、delete、optimistic remap、clear 等场景。React adapter 需要的
runtime/view store/row lookup 通过 package-internal helper 访问，不进入 public
type。
