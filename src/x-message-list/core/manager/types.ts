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

export type MessageListScrollMotionConfig = {
  enabled?: boolean | (() => boolean)
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
  incoming?: {
    getPageFocus?: () => boolean
    shouldFollowAppend?: MessageListIncomingAppendPolicy<Row, Conversation>
  }
  scrollMotion?: MessageListScrollMotionConfig
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

export type MessageListSessionState<Row = unknown> = {
  id: MessageListConversationId
  loaded: {
    rows: Row[]
    keys: string[]
    hasMoreBefore: boolean
    hasMoreAfter: boolean
  }
  edge: {
    before: {
      status: 'idle' | 'loading' | 'error' | 'exhausted'
    }
    after: {
      status: 'idle' | 'loading' | 'error' | 'exhausted'
    }
  }
  overlayStatus: MessageListOverlayStatus
  viewport: {
    bottomLockState: 'LOCKED' | 'UNLOCKED'
    pendingIntent:
      | 'edge-before'
      | 'edge-after'
      | 'underflow-fill'
      | 'follow-bottom'
      | 'destination'
      | null
    phase:
      | 'IDLE'
      | 'PROJECTING'
      | 'MEASURING'
      | 'CORRECTING'
      | 'MOTION'
    distanceToBottom: number
  }
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

export type MessageListRowsMutation<Row> = {
  patches?: Row[]
  removeKeys?: string[]
  invalidateKeys?: string[]
  reason?: string
}

export type MessageListIdentityRemap = {
  from: MessageListAnchor
  to: MessageListAnchor
  previousKey?: string
  nextKey: string
}

export type MessageListOutgoingStageInput<Row> = {
  rows: Row[]
  latest?: MessageListPage<Row>
  reason?: 'send' | 'retry'
  retireKeys?: string[]
}

export type MessageListIncomingAppendFollowDecision = 'follow' | 'preserve'

export type MessageListIncomingAppendContext<
  Row,
  Conversation = unknown,
> = {
  id: MessageListConversationId
  conversation: Conversation
  rows: Row[]
  reason?: string
  hasMoreAfter: boolean
  bottomLockState: 'LOCKED' | 'UNLOCKED'
  pendingIntent:
    | 'edge-before'
    | 'edge-after'
    | 'underflow-fill'
    | 'follow-bottom'
    | 'destination'
    | null
  viewportPhase:
    | 'IDLE'
    | 'PROJECTING'
    | 'MEASURING'
    | 'CORRECTING'
    | 'MOTION'
  distanceToBottom: number
  pageFocused: boolean
}

export type MessageListIncomingAppendPolicy<
  Row,
  Conversation = unknown,
> = (
  context: MessageListIncomingAppendContext<Row, Conversation>,
) => MessageListIncomingAppendFollowDecision | boolean

export type MessageListIncomingAppendFollowInput<Row> =
  | MessageListIncomingAppendFollowDecision
  | 'auto'
  | boolean
  | MessageListIncomingAppendPolicy<Row>

export type MessageListIncomingAppendInput<Row> = {
  rows: Row[]
  reason?: string
  follow?: MessageListIncomingAppendFollowInput<Row>
}

export type MessageListSession<Row = unknown> = {
  id: MessageListConversationId
  getState(): MessageListSessionState<Row>
  subscribe(listener: () => void): () => void
  commands: {
    scrollToLatest(): void
    scrollToMessage(
      target: MessageListAnchor,
      options?: MessageListScrollToMessageOptions,
    ): void
    loadBefore(): void
    loadAfter(): void
    reloadLatest(): void
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
  outgoing: {
    stage(input: Row | Row[] | MessageListOutgoingStageInput<Row>): void
    patch(rows: Row[]): void
    applyIdentityRemap(remaps: MessageListIdentityRemap[]): void
  }
  incoming: {
    append(input: Row | Row[] | MessageListIncomingAppendInput<Row>): void
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
