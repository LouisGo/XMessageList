import type {
  MessageListRuntimeEvent,
} from './events'
import type { LoadedSegment } from './segment'
import type {
  EdgeSnapshotState,
  MessageListSnapshot,
  PendingIntent,
} from './snapshot'
import type {
  EdgeNeedOptions,
  InteractionUpdate,
  RuntimeEdge,
} from './interactionTypes'

export class EdgeNeedCoordinator<TMessage, TOptimistic> {
  constructor(
    private readonly nextRequestToken: (kind: string) => string,
  ) {}

  reset(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    return {
      ...snapshot,
      edgeState: createIdleEdgeState(),
    }
  }

  start(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    edge: RuntimeEdge,
    reason: string,
    pendingIntent: PendingIntent,
    options: EdgeNeedOptions = {},
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    if (
      !canRequestEdge(snapshot, edge) ||
      !canEmitEdgeNeedForSource(options.source, options.ignoreScrollSource)
    ) {
      return null
    }

    const latchToken = createLatchToken(snapshot, edge)
    const requestToken = this.nextRequestToken(edge)
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

  retry(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    edge: RuntimeEdge,
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    if (snapshot.edgeState[edge].status !== 'error') {
      return null
    }

    const cleared = setEdgeState(snapshot, edge, { status: 'idle' })
    return this.start(
      cleared,
      edge,
      edge === 'before' ? 'retry-before' : 'retry-after',
      edge === 'before' ? 'edge-before' : 'edge-after',
      { ignoreScrollSource: true },
    )
  }

  reportError(
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

  settleSegment(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    if (segment.modifier.type === 'extend-before') {
      const next = settleEdge(snapshot, 'before', segment.modifier.requestToken)
      return next.pendingIntent === 'edge-before'
        ? { ...next, pendingIntent: null }
        : next
    }

    if (segment.modifier.type === 'extend-after') {
      const next = settleEdge(snapshot, 'after', segment.modifier.requestToken)
      return next.pendingIntent === 'edge-after'
        ? { ...next, pendingIntent: null }
        : next
    }

    if (segment.modifier.type === 'trim-before') {
      return clearTrimmedEdge(snapshot, 'before')
    }

    if (segment.modifier.type === 'trim-after') {
      return clearTrimmedEdge(snapshot, 'after')
    }

    return snapshot
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

function canEmitEdgeNeedForSource(
  source: EdgeNeedOptions['source'],
  ignoreScrollSource = false,
): boolean {
  if (ignoreScrollSource) {
    return true
  }

  return source === 'user' || source === 'momentum'
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

function clearTrimmedEdge<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  edge: RuntimeEdge,
): MessageListSnapshot<TMessage, TOptimistic> {
  const pendingIntent = edge === 'before' ? 'edge-before' : 'edge-after'

  return {
    ...setEdgeState(snapshot, edge, { status: 'idle' }),
    pendingIntent: snapshot.pendingIntent === pendingIntent
      ? null
      : snapshot.pendingIntent,
  }
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
