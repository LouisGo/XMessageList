export type MessageListSessionId = string
export type MessageListSessionSource = MessageListSessionId
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
    crossSession?: boolean
  }
}

export type MessageListRequestContext<Row, Source = MessageListSessionSource> = {
  sessionId: MessageListSessionId
  source: Source
  pageSize: number
  requestToken?: string
  reason?: string
  target?: MessageListResolvedAnchor
  boundaryRow?: Row
}

export type MessageListAdapter<Row, Source = MessageListSessionSource> = {
  row: {
    getKey(row: Row): string
    getAnchor(row: Row): MessageListAnchor | null
    getVersion?(row: Row): unknown
    getKind?(row: Row): string
  }
  request: {
    loadLatest(
      context: MessageListRequestContext<Row, Source>,
    ): Promise<MessageListPage<Row>>
    loadBefore(
      context: MessageListRequestContext<Row, Source>,
    ): Promise<MessageListPage<Row>>
    loadAfter(
      context: MessageListRequestContext<Row, Source>,
    ): Promise<MessageListPage<Row>>
    loadAround(
      context: MessageListRequestContext<Row, Source>,
    ): Promise<MessageListPage<Row>>
  }
  anchorMemory?: {
    load(
      context: MessageListSessionContext<Source>,
    ): MessageListAnchorMemoryValue | null |
      Promise<MessageListAnchorMemoryValue | null>
    save(
      context: MessageListSessionContext<Source>,
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

export type MessageListSessionContext<Source = MessageListSessionSource> = {
  sessionId: MessageListSessionId
  source: Source
}

export type MessageListScrollMotionConfig = {
  enabled?: boolean | (() => boolean)
}

export type MessageListRemoteTailAppendConfig<Row, Source = unknown> = {
  getPageFocus?: () => boolean
  shouldFollowRemoteAppend?: MessageListRemoteTailAppendPolicy<Row, Source>
}

export type MessageListSessionRegistryOptions<
  Row,
  Source = MessageListSessionSource,
> = {
  defaults?: {
    pageSize?: number
    retention?: MessageListSegmentRetention
    keepAlive?: {
      maxSessions?: number
      ttlMs?: number
    }
  }
  tailEvents?: MessageListRemoteTailAppendConfig<Row, Source>
  scrollMotion?: MessageListScrollMotionConfig
  getSessionSource?: (sessionId: MessageListSessionId) => Source
  getAdapter: (
    source: Source,
  ) => MessageListAdapter<Row, Source>
  onRequestResult?: (
    result: MessageListRequestResult<Row, Source>,
  ) => void
  onRuntimeEvent?: (
    event: MessageListRuntimeLogEvent,
  ) => void
}

export type MessageListSessionRegistryOptionsPatch<
  Row,
  Source = MessageListSessionSource,
> = {
  defaults?: {
    pageSize?: number
    keepAlive?: {
      maxSessions?: number
      ttlMs?: number
    }
  }
  tailEvents?: MessageListRemoteTailAppendConfig<Row, Source>
  scrollMotion?: MessageListScrollMotionConfig
  onRequestResult?: (
    result: MessageListRequestResult<Row, Source>,
  ) => void
  onRuntimeEvent?: (
    event: MessageListRuntimeLogEvent,
  ) => void
}

export type MessageListRequestResult<Row, Source> = {
  sessionId: MessageListSessionId
  source: Source
  kind: 'latest' | 'before' | 'after' | 'around'
  status: 'applied' | 'failed' | 'stale'
  page?: MessageListPage<Row>
  error?: unknown
}

export type MessageListRuntimeLogDiagnosticRecord = {
  name: string
  severity: 'debug' | 'info' | 'warn' | 'error'
  timestamp: number
  details: Record<string, unknown>
}

export type MessageListRuntimeLogEvent = {
  type: string
  sessionId?: MessageListSessionId
  generation?: number
  segmentRevision?: number
  requestToken?: string
  reason?: string
  edge?: 'before' | 'after'
  target?: MessageListAnchor
  anchor?: MessageListAnchor | null
  diagnostic?: MessageListRuntimeLogDiagnosticRecord
  details?: Record<string, unknown>
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
  Source = unknown,
> = {
  sessionId: MessageListSessionId
  source: Source
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
  Source = unknown,
> = (
  context: MessageListRemoteTailAppendContext<Row, Source>,
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
  sessionId: MessageListSessionId
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
  Source = MessageListSessionSource,
> = {
  getSession(sessionId: MessageListSessionId): MessageListSession<Row>
  hasSession(sessionId: MessageListSessionId): boolean
  destroySession(sessionId: MessageListSessionId): boolean
  destroyAll(): void
  getSessionIds(): MessageListSessionId[]
  getSessionMeta(sessionId: MessageListSessionId): MessageListSessionRegistryEntry | null
  retainSession(
    sessionId: MessageListSessionId,
    reason: MessageListSessionRetainReason,
  ): () => void
  updateOptions(options: MessageListSessionRegistryOptionsPatch<Row, Source>): void
  sweep(): void
}
