import type { NeedLatestMessagesEvent } from '../contracts/events'
import { FollowBottomIntentTracker } from './followBottomIntentTracker'
import type { LoadedSegment } from '../contracts/segment'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { InteractionUpdate } from '../state/interactionTypes'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'

export class FollowBottomCoordinator<TMessage, TOptimistic> {
  private readonly active = new FollowBottomIntentTracker<TMessage, TOptimistic>()

  constructor(
    private readonly axes: RuntimeStateAxes,
    private readonly nextRequestToken: (kind: string) => string,
  ) {}

  reset(): void {
    this.active.clear()
  }

  clear(): void {
    this.active.clear()
    if (this.axes.isReadySubstate('READY_FOLLOW_BOTTOM_PENDING')) {
      this.axes.markReadyIdle()
    }
    if (this.axes.getDestinationState() === 'pendingData') {
      this.axes.markDestinationIdle()
    }
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

    if (!snapshot.segmentMeta.hasMoreAfter) {
      this.axes.markReadyIdle()
      this.axes.markDestinationSettled()
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
    this.axes.markFollowBottomPending()
    this.axes.markDestinationPendingData()
    return {
      snapshot: {
        ...snapshot,
        bottomLockState: 'UNLOCKED',
        pendingIntent: 'follow-bottom',
      },
      event: createNeedLatestMessages(snapshot, requestToken),
    }
  }

  settleSegment(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    if (segment.modifier.type !== 'reset-latest' ||
      snapshot.pendingIntent !== 'follow-bottom') {
      return snapshot
    }

    if (segment.hasMoreAfter) {
      this.axes.markFollowBottomPending()
      this.axes.markDestinationPendingData()
    } else {
      this.axes.markReadyIdle()
      this.axes.markDestinationSettled()
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

    if (next.pendingIntent !== 'follow-bottom' &&
      this.axes.isReadySubstate('READY_FOLLOW_BOTTOM_PENDING')) {
      this.axes.markReadyIdle()
      this.axes.markDestinationInterrupted()
    }

    return next
  }
}

function createNeedLatestMessages<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  requestToken: string,
): NeedLatestMessagesEvent {
  return {
    type: 'needLatestMessages',
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    segmentRevision: snapshot.segmentRevision,
    requestToken,
    reason: 'bottom-follow',
  }
}
