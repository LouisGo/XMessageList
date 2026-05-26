import type {
  MessageIdentityAnchor,
} from './identity'
import type {
  MessageListRuntimeEvent,
  NeedMessagesAroundEvent,
} from './events'
import type { LoadedSegment } from './segment'
import type {
  EdgeSnapshotState,
  MessageListSnapshot,
  PendingIntent,
} from './snapshot'

export type RuntimeEdge = 'before' | 'after'

export type DestinationIntent = {
  target: MessageIdentityAnchor
  reason: 'jump' | 'restore'
  align: 'start' | 'center' | 'end' | 'nearest'
}

export type InteractionUpdate<TMessage, TOptimistic> = {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  event?: MessageListRuntimeEvent
}

export type UnderflowInput<TMessage, TOptimistic> = {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  scrollHeight: number
  clientHeight: number
}

export class RuntimeInteractionState<TMessage, TOptimistic> {
  private requestSequence = 0

  private pendingDestination: DestinationIntent | null = null

  private lastDestinationDirection: RuntimeEdge | null = null

  private lastUnderflowEdge: RuntimeEdge | null = null

  private readonly underflowRequests = new Set<string>()

  resetForGeneration(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    this.pendingDestination = null
    this.lastDestinationDirection = null
    this.lastUnderflowEdge = null
    this.underflowRequests.clear()
    return {
      ...snapshot,
      edgeState: createIdleEdgeState(),
      pendingIntent: null,
      bottomLockState: 'UNLOCKED',
    }
  }

  getPendingDestination(): DestinationIntent | null {
    return this.pendingDestination
  }

  startEdgeNeed(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    edge: RuntimeEdge,
    reason: string,
    pendingIntent: PendingIntent,
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    if (!canRequestEdge(snapshot, edge)) {
      return null
    }

    const latchToken = createLatchToken(snapshot, edge)
    const requestToken = this.nextRequestToken(snapshot.feedId, edge)
    const edgeState = {
      ...snapshot.edgeState,
      [edge]: {
        status: 'loading',
        latchToken,
        requestToken,
      } satisfies EdgeSnapshotState,
    }

    return {
      snapshot: {
        ...snapshot,
        edgeState,
        pendingIntent,
      },
      event: edge === 'before'
        ? createNeedMoreBefore(snapshot, requestToken, reason)
        : createNeedMoreAfter(snapshot, requestToken, reason),
    }
  }

  retryEdge(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    edge: RuntimeEdge,
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    if (snapshot.edgeState[edge].status !== 'error') {
      return null
    }

    const cleared = setEdgeState(snapshot, edge, { status: 'idle' })
    return this.startEdgeNeed(
      cleared,
      edge,
      edge === 'before' ? 'retry-before' : 'retry-after',
      edge === 'before' ? 'edge-before' : 'edge-after',
    )
  }

  reportEdgeError(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    edge: RuntimeEdge,
    requestToken: string,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    if (snapshot.edgeState[edge].requestToken !== requestToken) {
      return snapshot
    }

    return {
      ...setEdgeState(snapshot, edge, {
        status: 'error',
        latchToken: snapshot.edgeState[edge].latchToken,
        requestToken,
      }),
      pendingIntent: null,
    }
  }

  startFollowBottom(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): InteractionUpdate<TMessage, TOptimistic> {
    if (!snapshot.segmentMeta.hasMoreAfter) {
      return {
        snapshot: {
          ...snapshot,
          bottomLockState: 'LOCKED',
          pendingIntent: null,
          segmentMeta: {
            ...snapshot.segmentMeta,
            shortSegmentAlignment: 'end',
          },
        },
      }
    }

    const requestToken = this.nextRequestToken(snapshot.feedId, 'latest')
    return {
      snapshot: {
        ...snapshot,
        bottomLockState: 'UNLOCKED',
        pendingIntent: 'follow-bottom',
      },
      event: {
        type: 'needLatestMessages',
        feedId: snapshot.feedId,
        generation: snapshot.generation,
        segmentRevision: snapshot.segmentRevision,
        requestToken,
        reason: 'bottom-follow',
      },
    }
  }

  startDestination(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    intent: DestinationIntent,
  ): InteractionUpdate<TMessage, TOptimistic> {
    this.pendingDestination = intent
    this.lastDestinationDirection = resolveDestinationDirection(intent)
    const requestToken = this.nextRequestToken(snapshot.feedId, 'around')
    const event: NeedMessagesAroundEvent = {
      type: 'needMessagesAround',
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      segmentRevision: snapshot.segmentRevision,
      requestToken,
      reason: intent.reason,
      target: intent.target,
    }

    return {
      snapshot: {
        ...snapshot,
        pendingIntent: 'destination',
        bottomLockState: 'UNLOCKED',
      },
      event,
    }
  }

  settleSegment(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    let next = snapshot

    if (segment.modifier.type === 'extend-before') {
      next = settleEdge(next, 'before', segment.modifier.requestToken)
      if (next.pendingIntent === 'edge-before') {
        next = { ...next, pendingIntent: null }
      }
    }

    if (segment.modifier.type === 'extend-after') {
      next = settleEdge(next, 'after', segment.modifier.requestToken)
      if (next.pendingIntent === 'edge-after') {
        next = { ...next, pendingIntent: null }
      }
    }

    if (segment.modifier.type === 'reset-around' && this.pendingDestination) {
      this.pendingDestination = null
      next = {
        ...next,
        pendingIntent: null,
        bottomLockState: 'UNLOCKED',
      }
    }

    if (segment.modifier.type === 'reset-latest' && next.pendingIntent === 'follow-bottom') {
      next = {
        ...next,
        pendingIntent: segment.hasMoreAfter ? 'follow-bottom' : null,
        bottomLockState: segment.hasMoreAfter ? 'UNLOCKED' : 'LOCKED',
        segmentMeta: {
          ...next.segmentMeta,
          shortSegmentAlignment: segment.hasMoreAfter ? 'start' : 'end',
        },
      }
    }

    if (next.pendingIntent === 'underflow-fill') {
      next = {
        ...next,
        pendingIntent: null,
      }
    }

    return next
  }

  evaluateUnderflow(
    input: UnderflowInput<TMessage, TOptimistic>,
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    const { snapshot, scrollHeight, clientHeight } = input

    if (
      snapshot.viewportPhase !== 'IDLE' ||
      snapshot.pendingIntent ||
      scrollHeight > clientHeight + 2
    ) {
      return null
    }

    const edge = this.chooseUnderflowEdge(snapshot)

    if (!edge) {
      return {
        snapshot: {
          ...snapshot,
          segmentMeta: {
            ...snapshot.segmentMeta,
            underflow: 'settled',
          },
        },
      }
    }

    const requestKey = createLatchToken(snapshot, edge)

    if (this.underflowRequests.has(requestKey)) {
      return null
    }

    this.underflowRequests.add(requestKey)
    this.lastUnderflowEdge = edge
    const update = this.startEdgeNeed(
      snapshot,
      edge,
      'underflow-fill',
      'underflow-fill',
    )

    if (!update) {
      return null
    }

    return {
      ...update,
      snapshot: {
        ...update.snapshot,
        segmentMeta: {
          ...update.snapshot.segmentMeta,
          underflow: 'fillable',
        },
      },
    }
  }

  private nextRequestToken(feedId: string, kind: string): string {
    this.requestSequence += 1
    return `${feedId}:${kind}:${this.requestSequence}`
  }

  private chooseUnderflowEdge(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): RuntimeEdge | null {
    const canBefore = canRequestEdge(snapshot, 'before')
    const canAfter = canRequestEdge(snapshot, 'after')

    if (
      snapshot.bottomLockState === 'LOCKED' ||
      snapshot.segmentMeta.modifier.type === 'reset-latest'
    ) {
      return canBefore ? 'before' : null
    }

    if (canBefore && !canAfter) {
      return 'before'
    }

    if (canAfter && !canBefore) {
      return 'after'
    }

    if (!canBefore || !canAfter) {
      return null
    }

    if (snapshot.segmentMeta.modifier.type === 'reset-around') {
      return resolveResetAroundUnderflowEdge(
        snapshot,
        this.lastDestinationDirection,
        this.lastUnderflowEdge,
      )
    }

    return this.lastUnderflowEdge === 'before' ? 'after' : 'before'
  }
}

function createNeedMoreBefore<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  requestToken: string,
  reason: string,
): MessageListRuntimeEvent {
  return {
    type: 'needMoreBefore',
    edge: 'before',
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    segmentRevision: snapshot.segmentRevision,
    requestToken,
    reason,
  }
}

function createNeedMoreAfter<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  requestToken: string,
  reason: string,
): MessageListRuntimeEvent {
  return {
    type: 'needMoreAfter',
    edge: 'after',
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    segmentRevision: snapshot.segmentRevision,
    requestToken,
    reason,
  }
}

function canRequestEdge<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  edge: RuntimeEdge,
): boolean {
  const hasMore = edge === 'before'
    ? snapshot.segmentMeta.hasMoreBefore
    : snapshot.segmentMeta.hasMoreAfter

  return hasMore &&
    snapshot.viewportPhase === 'IDLE' &&
    snapshot.edgeState[edge].status === 'idle' &&
    snapshot.pendingIntent !== 'follow-bottom' &&
    snapshot.pendingIntent !== 'destination'
}

function settleEdge<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  edge: RuntimeEdge,
  requestToken: string,
): MessageListSnapshot<TMessage, TOptimistic> {
  if (snapshot.edgeState[edge].requestToken !== requestToken) {
    return snapshot
  }

  const hasMore = edge === 'before'
    ? snapshot.segmentMeta.hasMoreBefore
    : snapshot.segmentMeta.hasMoreAfter

  return setEdgeState(snapshot, edge, {
    status: hasMore ? 'idle' : 'exhausted',
  })
}

function setEdgeState<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  edge: RuntimeEdge,
  state: EdgeSnapshotState,
): MessageListSnapshot<TMessage, TOptimistic> {
  return {
    ...snapshot,
    edgeState: {
      ...snapshot.edgeState,
      [edge]: state,
    },
  }
}

function createIdleEdgeState(): MessageListSnapshot['edgeState'] {
  return {
    before: { status: 'idle' },
    after: { status: 'idle' },
  }
}

function createLatchToken<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  edge: RuntimeEdge,
): string {
  return `${snapshot.feedId}:${snapshot.generation}:${snapshot.segmentRevision}:${edge}`
}

function resolveResetAroundUnderflowEdge<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  destinationDirection: RuntimeEdge | null,
  lastUnderflowEdge: RuntimeEdge | null,
): RuntimeEdge {
  const target = snapshot.segmentMeta.modifier.type === 'reset-around'
    ? snapshot.segmentMeta.modifier.target
    : null
  const targetIndex = target ? findAnchorIndex(snapshot, target) : -1

  if (targetIndex >= 0) {
    const beforeCount = targetIndex
    const afterCount = snapshot.items.length - targetIndex - 1

    if (beforeCount < afterCount) {
      return 'before'
    }

    if (afterCount < beforeCount) {
      return 'after'
    }
  }

  return destinationDirection ?? (lastUnderflowEdge === 'before' ? 'after' : 'before')
}

function resolveDestinationDirection(intent: DestinationIntent): RuntimeEdge | null {
  if (intent.align === 'start') {
    return 'before'
  }

  if (intent.align === 'end') {
    return 'after'
  }

  return null
}

function findAnchorIndex<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  anchor: MessageIdentityAnchor,
): number {
  return snapshot.items.findIndex((item) => {
    const identity = item.identity

    return identity &&
      identity.feedId === anchor.feedId &&
      (
        identity.stableId === anchor.stableId ||
        Boolean(identity.serverId && identity.serverId === anchor.serverId) ||
        Boolean(identity.localId && identity.localId === anchor.localId)
      )
  })
}
