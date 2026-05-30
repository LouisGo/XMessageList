import type { MessageIdentityAnchor } from '../contracts/identity'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'
import type { InteractionUpdate, RuntimeEdge, UnderflowInput } from '../state/interactionTypes'

export class UnderflowCoordinator<TMessage, TOptimistic> {
  private lastEdge: RuntimeEdge | null = null

  private readonly requests = new Set<string>()

  constructor(
    private readonly axes: RuntimeStateAxes,
    private readonly tolerancePx = 2,
    private readonly edgeActivationMarginPx?: number,
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
    const edgeActivationMargin = resolveEdgeActivationMargin(
      clientHeight,
      this.edgeActivationMarginPx,
    )
    const needsMinimumRangeFill =
      scrollHeight <= clientHeight + edgeActivationMargin
    const bothEdgesInActivationMargin = areBothTriggersInActivationMargin(
      input,
      edgeActivationMargin,
    )

    if (
      snapshot.viewportPhase !== 'IDLE' ||
      snapshot.pendingIntent ||
      (
        !needsMinimumRangeFill &&
        !bothEdgesInActivationMargin &&
        scrollHeight > clientHeight + this.tolerancePx
      )
    ) {
      return null
    }

    if (!needsMinimumRangeFill && !bothEdgesInActivationMargin) {
      return null
    }

    const edge = this.chooseEdge(snapshot, destinationDirection)

    if (!edge) {
      this.axes.markReadyIdle()
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

    this.axes.markUnderflowPending()
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

    this.axes.markReadyIdle()
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

function resolveEdgeActivationMargin(
  clientHeight: number,
  configuredMarginPx?: number,
): number {
  return configuredMarginPx ?? Math.min(Math.max(clientHeight * 0.25, 64), 240)
}

function areBothTriggersInActivationMargin<TMessage, TOptimistic>(
  input: UnderflowInput<TMessage, TOptimistic>,
  marginPx: number,
): boolean {
  return isTriggerInActivationMargin(
    input.beforeTrigger,
    input.viewportTop,
    input.viewportBottom,
    marginPx,
  ) && isTriggerInActivationMargin(
    input.afterTrigger,
    input.viewportTop,
    input.viewportBottom,
    marginPx,
  )
}

function isTriggerInActivationMargin(
  rect: { top: number; bottom: number; height: number },
  viewportTop: number,
  viewportBottom: number,
  marginPx: number,
): boolean {
  return rect.height > 0 &&
    rect.bottom >= viewportTop - marginPx &&
    rect.top <= viewportBottom + marginPx
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
