import type { NeedMessagesAroundEvent } from '../contracts/events'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { DestinationIntent, InteractionUpdate, RuntimeEdge } from '../state/interactionTypes'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'

export class DestinationCoordinator<TMessage, TOptimistic> {
  private pending: DestinationIntent | null = null

  private lastDirection: RuntimeEdge | null = null

  constructor(
    private readonly axes: RuntimeStateAxes,
    private readonly nextRequestToken: (kind: string) => string,
  ) {}

  reset(): void {
    this.pending = null
    this.lastDirection = null
  }

  getPending(): DestinationIntent | null {
    return this.pending
  }

  getLastDirection(): RuntimeEdge | null {
    return this.lastDirection
  }

  clear(): void {
    this.pending = null
    this.lastDirection = null
    if (this.axes.isReadySubstate('READY_DESTINATION_PENDING')) {
      this.axes.markReadyIdle()
    }
    if (this.axes.getDestinationState() !== 'settled') {
      this.axes.markDestinationIdle()
    }
  }

  start(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    intent: DestinationIntent,
  ): InteractionUpdate<TMessage, TOptimistic> {
    // destination 先请求 around 数据；若目标已在本地，controller/motion 会绕过这里直接 settle。
    this.pending = intent
    this.lastDirection = resolveDestinationDirection(intent)
    this.axes.markDestinationPending()
    this.axes.markDestinationPendingData()
    const requestToken = this.nextRequestToken('around')
    const event: NeedMessagesAroundEvent = {
      type: 'needMessagesAround',
      sessionId: snapshot.sessionId,
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

  markLocalSettled(): void {
    this.pending = null
    this.lastDirection = null
    this.axes.markReadyIdle()
    this.axes.markDestinationSettled()
  }

  markResolvingDom(): void {
    if (this.pending) {
      this.axes.markDestinationResolvingDom()
    }
  }

  settleSegment(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    if (segment.modifier.type !== 'reset-around' || !this.pending) {
      return snapshot
    }

    this.pending = null
    this.lastDirection = null
    this.axes.markReadyIdle()
    this.axes.markDestinationSettled()
    return {
      ...snapshot,
      pendingIntent: null,
      bottomLockState: 'UNLOCKED',
    }
  }
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

export function isSameAnchorIdentity(
  left: MessageIdentityAnchor,
  right: MessageIdentityAnchor,
): boolean {
  return left.sessionId === right.sessionId &&
    (
      Boolean(left.serverId && left.serverId === right.serverId) ||
      left.stableId === right.stableId ||
      Boolean(left.localId && left.localId === right.localId)
    )
}
