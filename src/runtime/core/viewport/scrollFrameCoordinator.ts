import type { AnchorCoordinator } from '../../dom/anchorCoordinator'
import type { EdgeNeedCoordinator } from '../../events/edgeNeedCoordinator'
import type { DomRegistry } from '../../dom/domRegistry'
import type { LifecycleGuard } from '../state/lifecycleGuard'
import type { ProjectionCoordinator } from '../projection/projectionCoordinator'
import type { ProjectionStore } from '../state/projectionStore'
import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { TransactionRunner } from '../../transactions/transactionRunner'
import type { ViewportTransactionController } from '../../transactions/viewportTransactionController'
import type {
  AnchorState,
  MessageDataItem,
  MessageDataSnapshot,
  RenderWindow,
  RuntimeScheduler,
  RuntimeState,
  ScrollSource,
  ViewportAnchorChangeReason,
} from '../../types'
import type {
  ReadySubstate,
  RuntimeDiagnosticEmitter,
  ScrollFrameMetrics,
} from '../state/runtimeTypes'
import { readScrollFrameMetrics } from './scrollFrameMetrics'
import { maybeSlideWindow } from './scrollFrameWindowSlide'
import { ScrollbarDragEdgeCoordinator } from './scrollbarDragEdgeCoordinator'

export type ScrollFrameDeps<TMessage, TOptimistic> = {
  scheduler: RuntimeScheduler
  registry: DomRegistry
  lifecycle: LifecycleGuard
  store: ProjectionStore<TMessage, TOptimistic>
  scrollIntent: ScrollIntentEngine
  projection: ProjectionCoordinator<TMessage, TOptimistic>
  edge: EdgeNeedCoordinator<TMessage, TOptimistic>
  anchor: AnchorCoordinator<TMessage, TOptimistic>
  renderWindow: RenderWindowEngine
  transactions: TransactionRunner
  transactionController: ViewportTransactionController<TMessage, TOptimistic>
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  getCurrentFrame: () => number
  setCurrentFrame: (frame: number) => void
  getState: () => RuntimeState
  getReadySubstate: () => ReadySubstate
  getScrollbarDragIntentActive: () => boolean
  getScrollbarDragEdgeIntent: () => 'before' | 'after' | null
  setScrollbarDragEdgeIntent: (edge: 'before' | 'after' | null) => void
  getLastUserScrollTop: () => number
  setLastUserScrollTop: (scrollTop: number) => void
  getLastUserDistanceToBottom: () => number
  setLastUserDistanceToBottom: (distance: number) => void
  getLastDiagnosticScrollSource: () => ScrollSource | null
  setLastDiagnosticScrollSource: (source: ScrollSource | null) => void
  getEdgeThresholdPx: (metrics: ScrollFrameMetrics) => number
  setLastScrollSource: (source: ScrollSource | null) => void
  getEdgeLoadThresholdPx: () => number
  updatePendingFollowBottomForUserScroll: (scrollTop: number) => void
  updateActiveFollowBottomIntentForScroll: (
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    scrollSource: ScrollSource,
  ) => void
  scheduleViewportAnchorIdleEvent: () => void
  runAnchorlessWindowSlideTransaction: (
    nextWindow: RenderWindow,
    expectedData: { feedId: string; generation: number; revision: number },
  ) => Promise<void>
  emitViewportAnchorChanged: (
    reason: ViewportAnchorChangeReason,
    anchor?: AnchorState | null,
  ) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class ScrollFrameCoordinator<TMessage, TOptimistic> {
  private scrollRaf: number | null = null

  private readonly scrollbarDragEdge: ScrollbarDragEdgeCoordinator<
    TMessage,
    TOptimistic
  >

  constructor(private readonly deps: ScrollFrameDeps<TMessage, TOptimistic>) {
    this.scrollbarDragEdge = new ScrollbarDragEdgeCoordinator(deps)
  }

  scheduleScrollRaf(): void {
    if (this.scrollRaf !== null) {
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    this.scrollRaf = this.deps.scheduler.requestAnimationFrame(() => {
      this.scrollRaf = null
      this.incrementFrame()

      if (!this.deps.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.handleScrollFrame()
    })
  }

  scheduleScrollbarDragEdgeRecheck(reason: string): void {
    this.scrollbarDragEdge.scheduleRecheck(reason)
  }

  cancelScheduledWork(): void {
    if (this.scrollRaf !== null) {
      this.deps.scheduler.cancelAnimationFrame(this.scrollRaf)
      this.scrollRaf = null
    }

    this.scrollbarDragEdge.cancelScheduledWork()
  }

  private handleScrollFrame(): void {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const metrics = readScrollFrameMetrics(container)
    const scrollSource = this.deps.scrollIntent.classifyScroll(
      this.deps.getCurrentFrame(),
    )
    this.deps.setLastScrollSource(scrollSource)
    this.deps.updateActiveFollowBottomIntentForScroll(
      data,
      metrics.scrollTop,
      scrollSource,
    )
    this.emitScrollSourceDiagnostic(scrollSource, metrics)
    this.updateBottomLock(data, metrics, scrollSource)
    this.emitEdgeNeeds(data, metrics, scrollSource)

    if (scrollSource === 'user') {
      this.scrollbarDragEdge.updateEdgeIntent(data, metrics)
      // 只有真实用户滚动能更新用户意图基线；runtime 写 scrollTop 不应影响 edge latch 释放。
      this.deps.updatePendingFollowBottomForUserScroll(metrics.scrollTop)
      this.deps.setLastUserScrollTop(metrics.scrollTop)
      this.deps.setLastUserDistanceToBottom(metrics.distanceToBottom)
      this.deps.scheduleViewportAnchorIdleEvent()
    }

    if (this.deps.getState() === 'READY') {
      maybeSlideWindow(this.deps, data, metrics)
    }
  }

  private emitScrollSourceDiagnostic(
    scrollSource: ScrollSource,
    metrics: ScrollFrameMetrics,
  ): void {
    if (this.deps.getLastDiagnosticScrollSource() === scrollSource) {
      return
    }

    this.deps.setLastDiagnosticScrollSource(scrollSource)
    this.deps.emitDiagnostic({
      channel: 'scroll',
      severity: 'debug',
      name: 'scroll.sourceChanged',
      details: () => ({
        source: scrollSource,
        scrollTop: metrics.scrollTop,
        distanceToBottom: metrics.distanceToBottom,
      }),
    })
  }

  private updateBottomLock(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
    scrollSource: ScrollSource,
  ): void {
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()
    const changed = this.updateBottomLockForDataWindow(
      data,
      metrics.distanceToBottom,
      scrollSource,
    )

    if (!changed) {
      return
    }

    const nextBottomLockState = this.deps.scrollIntent.getBottomLockState()
    this.deps.emitDiagnostic({
      channel: 'scroll',
      severity: 'info',
      name: 'scroll.bottomLockChanged',
      details: () => ({
        previousBottomLockState,
        nextBottomLockState,
        source: scrollSource,
        distanceToBottom: metrics.distanceToBottom,
        hasMoreAfter: data.hasMoreAfter,
      }),
    })
    this.deps.projection.publish({
      data,
      renderWindow: this.keepCurrentWindow(data.items),
      bootstrapState: this.deps.store.getSnapshot().bootstrapState,
      bottomLockState: this.deps.scrollIntent.getBottomLockState(),
    })
  }

  private emitEdgeNeeds(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
    scrollSource: ScrollSource,
  ): void {
    this.deps.edge.emitEdgeNeeds({
      data,
      metrics,
      scrollSource,
      lastUserScrollTop: this.deps.getLastUserScrollTop(),
      lastUserDistanceToBottom: this.deps.getLastUserDistanceToBottom(),
    })
  }

  private updateBottomLockForDataWindow(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    distanceToBottom: number,
    scrollSource: ScrollSource,
  ): boolean {
    if (data.hasMoreAfter) {
      return this.deps.scrollIntent.setBottomLockState('UNLOCKED')
    }

    return this.deps.scrollIntent.updateBottomLockFromDistance(
      distanceToBottom,
      this.deps.getCurrentFrame(),
      scrollSource,
    )
  }

  private keepCurrentWindow(
    items: Array<MessageDataItem<TMessage, TOptimistic>>,
  ): RenderWindow {
    const currentWindow = this.deps.store.getSnapshot().renderWindow
    return this.deps.renderWindow.computeWindowFromRange(
      items,
      currentWindow.startIndex,
      currentWindow.endIndex,
    )
  }

  private incrementFrame(): void {
    this.deps.setCurrentFrame(this.deps.getCurrentFrame() + 1)
  }
}
