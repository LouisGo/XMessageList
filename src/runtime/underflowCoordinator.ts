import type { MessageIdentityAnchor } from './identity'
import type { MessageListSnapshot } from './snapshot'
import type { RuntimeStateAxes } from './runtimeStateAxes'
import type { InteractionUpdate, RuntimeEdge, UnderflowInput } from './interactionTypes'

export class UnderflowCoordinator<TMessage, TOptimistic> {
  private lastEdge: RuntimeEdge | null = null

  private readonly requests = new Set<string>()

  constructor(
    private readonly axes: RuntimeStateAxes,
    private readonly tolerancePx = 2,
  ) {}

  reset(): void {
    this.lastEdge = null
    this.requests.clear()
  }

  evaluate(
    input: UnderflowInput<TMessage, TOptimistic>,
    startEdgeNeed: (
      edge: RuntimeEdge,
      reason: string,
    ) => InteractionUpdate<TMessage, TOptimistic> | null,
    destinationDirection: RuntimeEdge | null,
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    const { snapshot, scrollHeight, clientHeight } = input

    if (
      snapshot.viewportPhase !== 'IDLE' ||
      snapshot.pendingIntent ||
      scrollHeight > clientHeight + this.tolerancePx
    ) {
      return null
    }

    const edge = this.chooseEdge(snapshot, destinationDirection)

    if (!edge) {
      this.axes.setReadySubstate('READY_IDLE')
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

    const requestKey = `${snapshot.feedId}:${snapshot.generation}:${snapshot.segmentRevision}:${edge}`

    if (this.requests.has(requestKey)) {
      return null
    }

    this.requests.add(requestKey)
    this.lastEdge = edge
    const update = startEdgeNeed(edge, 'underflow-fill')

    if (!update) {
      return null
    }

    this.axes.setReadySubstate('READY_UNDERFLOW_PENDING')
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

  settlePending(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    if (snapshot.pendingIntent !== 'underflow-fill') {
      return snapshot
    }

    this.axes.setReadySubstate('READY_IDLE')
    return {
      ...snapshot,
      pendingIntent: null,
    }
  }

  private chooseEdge(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    destinationDirection: RuntimeEdge | null,
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
        destinationDirection,
        this.lastEdge,
      )
    }

    return this.lastEdge === 'before' ? 'after' : 'before'
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
