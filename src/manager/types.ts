import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageListRuntime,
  MessageListRuntimeEvent,
  MessageListScrollToMessageOptions,
  MessageListSnapshot,
  ViewportObservationChangedEvent,
} from '../runtime/index'

export type MessageListConversationId = string

export type MessageListAnchor = {
  id?: string
  feedId?: string
  stableId?: string
  serverId?: string
  localId?: string
  fallbackStableId?: string
  fallbackReason?: 'deleted' | 'unavailable' | 'permission'
}

export type MessageListPage<Row> = {
  rows: Row[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  anchor?: MessageListAnchor
  anchorStatus?: 'normal' | 'deleted' | 'unavailable' | 'permission'
  total?: number
}

export type MessageListRequestContext<Row, Conversation> = {
  id: MessageListConversationId
  conversation: Conversation
  pageSize: number
  requestToken?: string
  reason?: string
  target?: MessageIdentityAnchor
  boundaryRow?: Row
}

export type MessageListAdapter<Row, Conversation = MessageListConversationId> = {
  row: {
    getKey(row: Row): string
    getAnchor(row: Row): MessageListAnchor | null
    getVersion?(row: Row): unknown
    getKind?(row: Row): string
  }
  request: {
    loadLatest(
      context: MessageListRequestContext<Row, Conversation>,
    ): Promise<MessageListPage<Row>>
    loadBefore(
      context: MessageListRequestContext<Row, Conversation>,
    ): Promise<MessageListPage<Row>>
    loadAfter(
      context: MessageListRequestContext<Row, Conversation>,
    ): Promise<MessageListPage<Row>>
    loadAround(
      context: MessageListRequestContext<Row, Conversation>,
    ): Promise<MessageListPage<Row>>
  }
  memory?: {
    loadAnchor(
      context: MessageListSessionContext<Conversation>,
    ): MessageListAnchor | null | Promise<MessageListAnchor | null>
    saveAnchor(
      context: MessageListSessionContext<Conversation>,
      anchor: MessageIdentityAnchor,
      offsetWithinMessage?: number,
    ): void | Promise<void>
  }
  readReceipt?: {
    batchDelayMs?: number
    shouldMarkRead?(row: Row): boolean
    markRead(rows: Row[]): void | Promise<void>
    onError?(error: unknown): void
  }
}

export type MessageListSessionContext<Conversation> = {
  id: MessageListConversationId
  conversation: Conversation
}

export type MessageListManagerOptions<Row, Conversation = MessageListConversationId> = {
  defaults?: {
    pageSize?: number
    maxItems?: number
    keepAlive?: {
      maxSessions?: number
      ttlMs?: number
    }
  }
  resolveConversation?: (id: MessageListConversationId) => Conversation
  resolveAdapter: (
    conversation: Conversation,
  ) => MessageListAdapter<Row, Conversation>
  onRequestResult?: (
    result: MessageListRequestResult<Row, Conversation>,
  ) => void
  onRuntimeEvent?: (
    event: MessageListRuntimeEvent,
    context: MessageListSessionContext<Conversation>,
  ) => void
}

export type MessageListRequestResult<Row, Conversation> = {
  id: MessageListConversationId
  conversation: Conversation
  kind: 'latest' | 'before' | 'after' | 'around'
  status: 'applied' | 'failed' | 'stale'
  page?: MessageListPage<Row>
  error?: unknown
}

export type MessageListOverlayStatus = {
  status: 'idle' | 'loading' | 'error'
  retry: () => void
  error?: unknown
}

export type MessageListViewState = {
  overlayStatus: MessageListOverlayStatus
}

export type MessageListController<Row = unknown> = {
  id: MessageListConversationId
  runtime: MessageListRuntime<Row>
  commands: {
    scrollToLatest(): void
    scrollToMessage(
      target: MessageIdentityAnchor,
      options?: MessageListScrollToMessageOptions,
    ): void
    reloadLatest(): void
  }
  getSnapshot(): MessageListSnapshot<Row>
  getViewState(): MessageListViewState
  subscribeView(listener: () => void): () => void
  getRow(item: MessageDataItem<Row>): Row | null
  getRowRenderVersion(item: MessageDataItem<Row>): unknown
  getRowsByKeys(keys: string[]): Row[]
}

export type MessageListManager<Row = unknown> = {
  getController(id: MessageListConversationId): MessageListController<Row>
  hasSession(id: MessageListConversationId): boolean
  destroySession(id: MessageListConversationId): boolean
  destroyAll(): void
  getSessionIds(): MessageListConversationId[]
  sweep(): void
}

export type MessageListObservationHandler = (
  event: ViewportObservationChangedEvent,
) => void
