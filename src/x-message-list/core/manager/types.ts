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

export type MessageListResolvedAnchor = {
  id?: string
  feedId: string
  stableId: string
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

export type MessageListAnchorMemoryValue = {
  anchor: MessageListAnchor
  offsetWithinMessage?: number
}

export type MessageListScrollToMessageOptions = {
  behavior?: ScrollBehavior
  align?: 'start' | 'center' | 'end' | 'nearest'
  motion?: {
    origin?: MessageListAnchor
    direction?: 'before' | 'after' | 'none'
    crossFeed?: boolean
  }
}

export type MessageListRequestContext<Row, Conversation> = {
  id: MessageListConversationId
  conversation: Conversation
  pageSize: number
  requestToken?: string
  reason?: string
  target?: MessageListResolvedAnchor
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
  anchorMemory?: {
    load(
      context: MessageListSessionContext<Conversation>,
    ): MessageListAnchorMemoryValue | null |
      Promise<MessageListAnchorMemoryValue | null>
    save(
      context: MessageListSessionContext<Conversation>,
      value: MessageListAnchorMemoryValue,
    ): void | Promise<void>
  }
  readReceipts?: {
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
  getConversation?: (id: MessageListConversationId) => Conversation
  getAdapter: (
    conversation: Conversation,
  ) => MessageListAdapter<Row, Conversation>
  onRequestResult?: (
    result: MessageListRequestResult<Row, Conversation>,
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

export type MessageListRowsReplaceInput<Row> = {
  rows: Row[]
  changedKeys?: string[]
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
  anchor?: MessageListAnchor
  anchorStatus?: MessageListPage<Row>['anchorStatus']
}

export type MessageListRowsResetAroundInput<Row> = MessageListPage<Row> & {
  target: MessageListAnchor
  align?: 'start' | 'center' | 'end' | 'nearest'
  offsetWithinMessage?: number
}

export type MessageListIdentityRemap = {
  from: MessageListAnchor
  to: MessageListAnchor
  previousKey?: string
  nextKey: string
}

export type MessageListSession<Row = unknown> = {
  id: MessageListConversationId
  commands: {
    scrollToLatest(): void
    scrollToMessage(
      target: MessageListAnchor,
      options?: MessageListScrollToMessageOptions,
    ): void
    reloadLatest(): void
  }
  rows: {
    patch(rows: Row[]): void
    replace(input: MessageListRowsReplaceInput<Row>): void
    resetLatest(page: MessageListPage<Row>): void
    resetAround(input: MessageListRowsResetAroundInput<Row>): void
    applyIdentityRemap(remaps: MessageListIdentityRemap[]): void
    clear(): void
  }
}

export type MessageListManager<Row = unknown> = {
  getSession(id: MessageListConversationId): MessageListSession<Row>
  hasSession(id: MessageListConversationId): boolean
  destroySession(id: MessageListConversationId): boolean
  destroyAll(): void
  getSessionIds(): MessageListConversationId[]
  sweep(): void
}
