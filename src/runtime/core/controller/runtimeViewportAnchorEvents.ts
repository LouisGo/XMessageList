import type { LifecycleGuard } from '../state/lifecycleGuard'
import type {
  AnchorState,
  MessageDataSnapshot,
  MessageViewportRuntimeEvent,
  RuntimeScheduler,
  RuntimeState,
  ViewportAnchorChangeReason,
  ViewportTransactionKind,
} from '../../types'
import {
  VIEWPORT_ANCHOR_IDLE_MS,
  cloneAnchorState,
} from '../state/runtimeTypes'

type RuntimeViewportAnchorEventDeps<TMessage, TOptimistic> = {
  scheduler: RuntimeScheduler
  lifecycle: LifecycleGuard
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  getState: () => RuntimeState
  getActiveTransactionKind: () => ViewportTransactionKind | null
  captureViewportAnchor: () => AnchorState | null
  scheduleScrollbarDragEdgeRecheck: (reason: string) => void
  emitViewportObservationChanged: (reason: ViewportAnchorChangeReason) => void
  resetViewportObservation: () => void
  emitEvent: (event: MessageViewportRuntimeEvent) => void
}

export class RuntimeViewportAnchorEvents<TMessage, TOptimistic> {
  private anchorIdleTimer: number | null = null

  constructor(
    private readonly deps: RuntimeViewportAnchorEventDeps<TMessage, TOptimistic>,
  ) {}

  scheduleIdleEvent(): void {
    if (this.anchorIdleTimer !== null) {
      this.deps.scheduler.clearTimeout(this.anchorIdleTimer)
    }

    const token = this.deps.lifecycle.getCurrent()
    this.anchorIdleTimer = this.deps.scheduler.setTimeout(() => {
      this.anchorIdleTimer = null

      if (!this.deps.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.emitChanged('scroll-idle')
    }, VIEWPORT_ANCHOR_IDLE_MS)
  }

  emitChanged(
    reason: ViewportAnchorChangeReason,
    anchorOverride?: AnchorState | null,
  ): void {
    const data = this.deps.getDataSnapshot()

    if (!data || this.deps.getState() === 'DESTROYED') {
      return
    }

    const anchor =
      typeof anchorOverride === 'undefined'
        ? this.deps.captureViewportAnchor()
        : anchorOverride

    this.deps.emitViewportObservationChanged(reason)
    this.deps.emitEvent({
      type: 'viewportAnchorChanged',
      feedId: data.feedId,
      generation: data.generation,
      reason,
      anchor: anchor ? cloneAnchorState(anchor) : null,
    })

    const activeTransactionKind = this.deps.getActiveTransactionKind()

    // append/prepend settle 后补一次拖拽边缘检测，避免 window slide 改变 spacer 后漏发 edge need。
    if (
      reason === 'transaction-settle' &&
      (activeTransactionKind === 'prepend' ||
        activeTransactionKind === 'append')
    ) {
      this.deps.scheduleScrollbarDragEdgeRecheck(
        `transaction-settle:${activeTransactionKind}`,
      )
    }
  }

  cancelScheduledWork(): void {
    this.deps.resetViewportObservation()

    if (this.anchorIdleTimer === null) {
      return
    }

    this.deps.scheduler.clearTimeout(this.anchorIdleTimer)
    this.anchorIdleTimer = null
  }
}
