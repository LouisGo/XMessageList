import {
  USER_SCROLL_DIRECTION_EPSILON_PX,
  type PendingFollowBottom,
  type ReadySubstate,
  type RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'
import type {
  DestinationState,
  MessageDataSnapshot,
  MessageViewportRuntimeEvent,
} from '../../types'
import { emitPendingFollowBottomNeed } from './destinationIntentEvents'
import { isLatestRebuildSnapshot } from './pendingResponseGuards'

type PendingFollowBottomDeps = {
  edge: {
    setAfterEdgeLatched(value: boolean): void
  }
  lifecycle: {
    getCurrent(): { feedId: string; generation: number }
  }
  scrollIntent: {
    setBottomLockState(state: 'LOCKED' | 'UNLOCKED'): boolean
  }
  getDataSnapshot: () => MessageDataSnapshot<unknown, unknown> | null
  setReadySubstate: (state: ReadySubstate) => void
  getReadySubstate: () => ReadySubstate
  setDestinationState: (state: DestinationState) => void
  getDestinationState: () => DestinationState
  emitEvent: (event: MessageViewportRuntimeEvent) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export type PendingFollowBottomDriveResult =
  | 'none'
  | 'pending'
  | 'generation-change'
  | 'enqueue-follow-bottom'

export class PendingFollowBottomTracker<TMessage, TOptimistic> {
  private pending: PendingFollowBottom | null = null

  constructor(private readonly deps: PendingFollowBottomDeps) {}

  has(): boolean {
    return this.pending !== null
  }

  clear(): void {
    if (!this.pending) {
      return
    }

    this.pending = null

    if (this.deps.getReadySubstate() === 'READY_FOLLOW_BOTTOM_PENDING') {
      this.deps.setReadySubstate('READY_IDLE')
    }
    if (this.deps.getDestinationState() === 'pendingData') {
      this.deps.setDestinationState('idle')
    }
  }

  drive(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): PendingFollowBottomDriveResult {
    const pending = this.pending

    if (!pending) {
      return 'none'
    }

    if (
      pending.feedId !== snapshot.feedId ||
      pending.generation !== snapshot.generation
    ) {
      this.clear()
      return 'generation-change'
    }

    if (!isLatestRebuildSnapshot(snapshot)) {
      // pending latest 只消费 reset rebuild 回包；普通 append/patch 不能被误认成 feed latest。
      this.emitNeed(snapshot)
      return 'pending'
    }

    this.clear()
    return 'enqueue-follow-bottom'
  }

  updateForUserScroll(scrollTop: number): 'user-scroll-up' | null {
    const pending = this.pending

    if (!pending) {
      return null
    }

    if (scrollTop < pending.lastScrollTop - USER_SCROLL_DIRECTION_EPSILON_PX) {
      // 用户主动向上阅读时，pending follow-bottom 必须让位，不能继续追逐 latest。
      this.clear()
      return 'user-scroll-up'
    }

    pending.lastScrollTop = scrollTop
    return null
  }

  start(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    commandId: string,
  ): void {
    this.pending = {
      feedId: data.feedId,
      generation: data.generation,
      commandId,
      emittedAfterRevision: null,
      lastScrollTop: scrollTop,
    }
    this.deps.setReadySubstate('READY_FOLLOW_BOTTOM_PENDING')
    this.deps.setDestinationState('pendingData')
    this.deps.scrollIntent.setBottomLockState('UNLOCKED')
    this.deps.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'followBottom.pending',
      correlationId: `command:${commandId}`,
      details: () => ({
        revision: data.revision,
        itemCount: data.items.length,
        hasMoreBefore: data.hasMoreBefore,
        hasMoreAfter: data.hasMoreAfter,
        scrollTop,
      }),
    })
    this.emitNeed(data)
  }

  private emitNeed(data: MessageDataSnapshot<TMessage, TOptimistic>): void {
    emitPendingFollowBottomNeed(this.deps, this.pending, data)
  }
}
