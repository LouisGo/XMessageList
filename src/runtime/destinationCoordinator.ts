import type { NeedMessagesAroundEvent } from './events'
import type { MessageIdentityAnchor } from './identity'
import type { LoadedSegment } from './segment'
import type { MessageListSnapshot } from './snapshot'
import type { DestinationIntent, InteractionUpdate, RuntimeEdge } from './interactionTypes'
import type { RuntimeStateAxes } from './runtimeStateAxes'

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
    if (this.axes.getReadySubstate() === 'READY_DESTINATION_PENDING') {
      this.axes.setReadySubstate('READY_IDLE')
    }
    if (this.axes.getDestinationState() !== 'settled') {
      this.axes.setDestinationState('idle')
    }
  }

  start(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    intent: DestinationIntent,
  ): InteractionUpdate<TMessage, TOptimistic> {
    this.pending = intent
    this.lastDirection = resolveDestinationDirection(intent)
    this.axes.setReadySubstate('READY_DESTINATION_PENDING')
    this.axes.setDestinationState('pendingData')
    const requestToken = this.nextRequestToken('around')
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

  markLocalSettled(): void {
    this.pending = null
    this.lastDirection = null
    this.axes.setReadySubstate('READY_IDLE')
    this.axes.setDestinationState('settled')
  }

  markResolvingDom(): void {
    if (this.pending) {
      this.axes.setDestinationState('resolvingDom')
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
    this.axes.setReadySubstate('READY_IDLE')
    this.axes.setDestinationState('settled')
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
  return left.feedId === right.feedId &&
    (
      Boolean(left.serverId && left.serverId === right.serverId) ||
      left.stableId === right.stableId ||
      Boolean(left.localId && left.localId === right.localId)
    )
}
