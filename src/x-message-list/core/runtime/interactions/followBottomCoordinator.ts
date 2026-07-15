import type { NeedLatestMessagesEvent } from '../contracts/events'
import { FollowBottomIntentTracker } from './followBottomIntentTracker'
import type { LoadedSegment } from '../contracts/segment'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { InteractionUpdate } from '../state/interactionTypes'

export class FollowBottomCoordinator<TMessage, TOptimistic> {
  private readonly active = new FollowBottomIntentTracker<TMessage, TOptimistic>()

  constructor(
    private readonly nextRequestToken: (kind: string) => string,
  ) {}

  reset(): void {
    this.active.clear()
  }

  clear(): void {
    this.active.clear()
  }

  hasActive(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): boolean {
    return this.active.has(snapshot)
  }

  start(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    scrollTop = 0,
  ): InteractionUpdate<TMessage, TOptimistic> {
    this.active.ensure(snapshot, scrollTop)

    if (
      snapshot.segmentMeta.context === 'latest' &&
      !snapshot.segmentMeta.hasMoreAfter
    ) {
      // 已在源最新端时不发 needLatest，直接锁底并把短窗口对齐到底部。
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

    const requestToken = this.nextRequestToken('latest')
    return {
      snapshot: {
        ...snapshot,
        bottomLockState: 'UNLOCKED',
        pendingIntent: 'follow-bottom',
      },
      event: createNeedLatestMessages(snapshot, requestToken),
    }
  }

  startForLocalReset(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    scrollTop = 0,
  ): InteractionUpdate<TMessage, TOptimistic> {
    this.active.ensure(snapshot, scrollTop)
    return {
      snapshot: {
        ...snapshot,
        bottomLockState: 'UNLOCKED',
        pendingIntent: 'follow-bottom',
      },
    }
  }

  settleSegment(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    if (!isFollowBottomSettleSegment(segment) ||
      snapshot.pendingIntent !== 'follow-bottom') {
      return snapshot
    }

    return {
      ...snapshot,
      pendingIntent: segment.hasMoreAfter ? 'follow-bottom' : null,
      bottomLockState: segment.hasMoreAfter ? 'UNLOCKED' : 'LOCKED',
      segmentMeta: {
        ...snapshot.segmentMeta,
        shortSegmentAlignment: segment.hasMoreAfter ? 'start' : 'end',
      },
    }
  }

  updateForScroll(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    source: ScrollSource,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    const next = this.active.updateForScroll(snapshot, scrollTop, source)

    return next
  }
}

function isFollowBottomSettleSegment<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
): boolean {
  return segment.modifier.type === 'reset-latest' ||
    (
      segment.modifier.type === 'extend-after' &&
      segment.context === 'latest'
    )
}

function createNeedLatestMessages<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  requestToken: string,
): NeedLatestMessagesEvent {
  return {
    type: 'needLatestMessages',
    sessionId: snapshot.sessionId,
    generation: snapshot.generation,
    segmentRevision: snapshot.segmentRevision,
    requestToken,
    reason: 'bottom-follow',
  }
}
