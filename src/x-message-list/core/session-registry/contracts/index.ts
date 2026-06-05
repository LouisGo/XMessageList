export type MessageListSessionId = string
export type MessageListSegmentRetention = 'low' | 'balanced' | 'high'

export type MessageListAnchor = {
  id?: string
  sessionId?: string
  stableId?: string
  serverId?: string
  localId?: string
  fallbackStableId?: string
  fallbackReason?: 'deleted' | 'unavailable' | 'permission'
}

export type MessageListResolvedAnchor = {
  id?: string
  sessionId: string
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

export type MessageListRequestContext<Row, Feed = MessageListSessionId> = {
  id: MessageListSessionId
  sessionId: MessageListSessionId
  feed: Feed
  pageSize: number
  requestToken?: string
  reason?: string
  target?: MessageListResolvedAnchor
  boundaryRow?: Row
}

export type MessageListAdapter<Row, Feed = MessageListSessionId> = {
  row: {
    getKey(row: Row): string
    getAnchor(row: Row): MessageListAnchor | null
    getVersion?(row: Row): unknown
    getKind?(row: Row): string
  }
  request: {
    loadLatest(
      context: MessageListRequestContext<Row, Feed>,
    ): Promise<MessageListPage<Row>>
    loadBefore(
      context: MessageListRequestContext<Row, Feed>,
    ): Promise<MessageListPage<Row>>
    loadAfter(
      context: MessageListRequestContext<Row, Feed>,
    ): Promise<MessageListPage<Row>>
    loadAround(
      context: MessageListRequestContext<Row, Feed>,
    ): Promise<MessageListPage<Row>>
  }
  anchorMemory?: {
    load(
      context: MessageListSessionContext<Feed>,
    ): MessageListAnchorMemoryValue | null |
      Promise<MessageListAnchorMemoryValue | null>
    save(
      context: MessageListSessionContext<Feed>,
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

export type MessageListSessionContext<Feed = MessageListSessionId> = {
  id: MessageListSessionId
  sessionId: MessageListSessionId
  feed: Feed
}

export type MessageListScrollMotionConfig = {
  enabled?: boolean | (() => boolean)
}

export type MessageListRemoteTailAppendConfig<Row, Feed = unknown> = {
  getPageFocus?: () => boolean
  shouldFollowRemoteAppend?: MessageListRemoteTailAppendPolicy<Row, Feed>
}

export type MessageListSessionRegistryOptions<
  Row,
  Feed = MessageListSessionId,
> = {
  defaults?: {
    pageSize?: number
    retention?: MessageListSegmentRetention
    keepAlive?: {
      maxSessions?: number
      ttlMs?: number
    }
  }
  tailEvents?: MessageListRemoteTailAppendConfig<Row, Feed>
  scrollMotion?: MessageListScrollMotionConfig
  getFeed?: (id: MessageListSessionId) => Feed
  getAdapter: (
    feed: Feed,
  ) => MessageListAdapter<Row, Feed>
  onRequestResult?: (
    result: MessageListRequestResult<Row, Feed>,
  ) => void
}

export type MessageListSessionRegistryOptionsPatch<
  Row,
  Feed = MessageListSessionId,
> = {
  defaults?: {
    pageSize?: number
    keepAlive?: {
      maxSessions?: number
      ttlMs?: number
    }
  }
  tailEvents?: MessageListRemoteTailAppendConfig<Row, Feed>
  scrollMotion?: MessageListScrollMotionConfig
  onRequestResult?: (
    result: MessageListRequestResult<Row, Feed>,
  ) => void
}

export type MessageListRequestResult<Row, Feed> = {
  id: MessageListSessionId
  sessionId: MessageListSessionId
  feed: Feed
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
  id: MessageListSessionId
  sessionId: MessageListSessionId
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

export type MessageListLocalTailStageInput<Row> = {
  rows: Row[]
  latest?: MessageListPage<Row>
  reason?: 'send' | 'retry'
  retireKeys?: string[]
}

export type MessageListTailAppendFollowDecision = 'follow' | 'preserve'

export type MessageListRemoteTailAppendContext<
  Row,
  Feed = unknown,
> = {
  id: MessageListSessionId
  sessionId: MessageListSessionId
  feed: Feed
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

export type MessageListRemoteTailAppendPolicy<
  Row,
  Feed = unknown,
> = (
  context: MessageListRemoteTailAppendContext<Row, Feed>,
) => MessageListTailAppendFollowDecision | boolean

export type MessageListTailAppendFollowInput<Row> =
  | MessageListTailAppendFollowDecision
  | 'auto'
  | boolean
  | MessageListRemoteTailAppendPolicy<Row>

export type MessageListRemoteTailAppendInput<Row> = {
  rows: Row[]
  reason?: string
  follow?: MessageListTailAppendFollowInput<Row>
}

export type MessageListSession<Row = unknown> = {
  id: MessageListSessionId
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

export type MessageListSessionRetainReason =
  | 'active-session'
  | 'split-view'
  | 'prefetch'

export type MessageListSessionRegistryEntryStatus =
  | 'mounted'
  | 'active'
  | 'cached'

export type MessageListSessionRegistryEntry = {
  sessionId: MessageListSessionId
  createdAt: number
  lastUsedAt: number
  mountedRetainCount: number
  hostRetainCount: number
  status: MessageListSessionRegistryEntryStatus
}

export type MessageListSessionRegistry<
  Row = unknown,
  Feed = MessageListSessionId,
> = {
  getSession(id: MessageListSessionId): MessageListSession<Row>
  hasSession(id: MessageListSessionId): boolean
  destroySession(id: MessageListSessionId): boolean
  destroyAll(): void
  getSessionIds(): MessageListSessionId[]
  getSessionMeta(id: MessageListSessionId): MessageListSessionRegistryEntry | null
  retainSession(
    id: MessageListSessionId,
    reason: MessageListSessionRetainReason,
  ): () => void
  updateOptions(options: MessageListSessionRegistryOptionsPatch<Row, Feed>): void
  sweep(): void
}
