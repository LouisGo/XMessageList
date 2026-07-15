import type { NeedMessagesAroundEvent } from '../contracts/events'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { DestinationIntent, InteractionUpdate, RuntimeEdge } from '../state/interactionTypes'

export class DestinationCoordinator<TMessage, TOptimistic> {
  private pending: DestinationIntent | null = null

  private lastDirection: RuntimeEdge | null = null

  constructor(
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
  }

  start(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    intent: DestinationIntent,
  ): InteractionUpdate<TMessage, TOptimistic> {
    // destination 先请求 around 数据；若目标已在本地，controller/motion 会绕过这里直接 settle。
    const requestToken = this.nextRequestToken('around')
    this.pending = { ...intent, requestToken }
    this.lastDirection = resolveDestinationDirection(intent)
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

  interruptForUserInput(): DestinationIntent | null {
    const pending = this.pending
    if (!pending) {
      return null
    }

    this.pending = null
    this.lastDirection = null
    return pending
  }

  /** 由上层 Session 显式取代命令；不伪装成用户输入事件。 */
  cancel(): DestinationIntent | null {
    const pending = this.pending
    this.pending = null
    this.lastDirection = null
    return pending
  }

  acceptsSegment(segment: LoadedSegment<TMessage, TOptimistic>): boolean {
    if (segment.modifier.type !== 'reset-around' || !segment.modifier.requestToken) {
      return true
    }

    return this.pending?.requestToken === segment.modifier.requestToken
  }

  markLocalSettled(): void {
    this.pending = null
    this.lastDirection = null
  }

  settleSegment(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    if (
      segment.modifier.type !== 'reset-around' ||
      !this.pending ||
      !this.acceptsSegment(segment)
    ) {
      return snapshot
    }

    this.pending = null
    this.lastDirection = null
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
