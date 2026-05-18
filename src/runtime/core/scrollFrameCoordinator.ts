import type { AnchorCoordinator } from '../dom/anchorCoordinator'
import type { EdgeNeedCoordinator } from '../events/edgeNeedCoordinator'
import type { DomRegistry } from '../dom/domRegistry'
import type { LifecycleGuard } from './lifecycleGuard'
import type { ProjectionCoordinator } from './projectionCoordinator'
import type { ProjectionStore } from './projectionStore'
import type { RenderWindowEngine } from '../window/renderWindowEngine'
import type { ScrollIntentEngine } from '../scroll/scrollIntentEngine'
import type { TransactionRunner } from '../transactions/transactionRunner'
import type { ViewportTransactionController } from '../transactions/viewportTransactionController'
import type {
  AnchorState,
  MessageDataItem,
  MessageDataSnapshot,
  RenderWindow,
  RuntimeScheduler,
  RuntimeState,
  ScrollSource,
  ViewportAnchorChangeReason,
} from '../types'
import type {
  ReadySubstate,
  RuntimeDiagnosticEmitter,
  ScrollFrameMetrics,
} from './runtimeTypes'

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

  private scrollbarDragEdgeRecheckRaf: number | null = null

  constructor(private readonly deps: ScrollFrameDeps<TMessage, TOptimistic>) {}

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
    if (
      !this.deps.getScrollbarDragIntentActive() ||
      this.scrollbarDragEdgeRecheckRaf !== null
    ) {
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    this.scrollbarDragEdgeRecheckRaf =
      this.deps.scheduler.requestAnimationFrame(() => {
        this.scrollbarDragEdgeRecheckRaf = null
        this.incrementFrame()

        if (!this.deps.lifecycle.isCurrent(token.feedId, token.generation)) {
          return
        }

        this.handleScrollbarDragEdgeRecheckFrame(reason)
      })
  }

  cancelScheduledWork(): void {
    if (this.scrollRaf !== null) {
      this.deps.scheduler.cancelAnimationFrame(this.scrollRaf)
      this.scrollRaf = null
    }

    if (this.scrollbarDragEdgeRecheckRaf !== null) {
      this.deps.scheduler.cancelAnimationFrame(this.scrollbarDragEdgeRecheckRaf)
      this.scrollbarDragEdgeRecheckRaf = null
    }
  }

  private handleScrollbarDragEdgeRecheckFrame(reason: string): void {
    if (
      !this.deps.getScrollbarDragIntentActive() ||
      this.deps.getState() !== 'READY'
    ) {
      return
    }

    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const metrics = readScrollFrameMetrics(container)
    const edgeMetrics = this.getScrollbarDragEdgeIntentMetrics(data, metrics)
    this.deps.setLastScrollSource('user')
    this.deps.emitDiagnostic({
      channel: 'edge',
      severity: 'debug',
      name: 'edge.scrollbarDragRecheck',
      details: () => ({
        reason,
        edgeIntent: this.deps.getScrollbarDragEdgeIntent(),
        scrollTop: edgeMetrics.scrollTop,
        distanceToBottom: edgeMetrics.distanceToBottom,
        actualScrollTop: metrics.scrollTop,
        actualDistanceToBottom: metrics.distanceToBottom,
        scrollHeight: edgeMetrics.scrollHeight,
        clientHeight: edgeMetrics.clientHeight,
      }),
    })
    this.deps.edge.emitEdgeNeeds({
      data,
      metrics: edgeMetrics,
      scrollSource: 'user',
      lastUserScrollTop: this.deps.getLastUserScrollTop(),
      lastUserDistanceToBottom: this.deps.getLastUserDistanceToBottom(),
    })
    const edgeIntent = this.deps.getScrollbarDragEdgeIntent()
    if (edgeIntent) {
      this.deps.edge.emitScrollbarDragEdgeNeed({
        data,
        edge: edgeIntent,
      })
    }
    this.deps.setLastUserScrollTop(edgeMetrics.scrollTop)
    this.deps.setLastUserDistanceToBottom(edgeMetrics.distanceToBottom)
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
      this.updateScrollbarDragEdgeIntent(data, metrics)
      // 只有真实用户滚动能更新用户意图基线；runtime 写 scrollTop 不应影响 edge latch 释放。
      this.deps.updatePendingFollowBottomForUserScroll(metrics.scrollTop)
      this.deps.setLastUserScrollTop(metrics.scrollTop)
      this.deps.setLastUserDistanceToBottom(metrics.distanceToBottom)
      this.deps.scheduleViewportAnchorIdleEvent()
    }

    if (this.deps.getState() === 'READY') {
      this.maybeSlideWindow(data, metrics)
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

  private updateScrollbarDragEdgeIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
  ): void {
    if (!this.deps.getScrollbarDragIntentActive()) {
      return
    }

    const snapshot = this.deps.store.getSnapshot()

    if (
      data.hasMoreBefore &&
      snapshot.renderWindow.startIndex === 0 &&
      metrics.scrollTop <= this.deps.getEdgeLoadThresholdPx()
    ) {
      this.deps.setScrollbarDragEdgeIntent('before')
      return
    }

    if (
      data.hasMoreAfter &&
      snapshot.renderWindow.endIndex >= data.items.length - 1 &&
      metrics.distanceToBottom <= this.deps.getEdgeLoadThresholdPx()
    ) {
      this.deps.setScrollbarDragEdgeIntent('after')
    }
  }

  private getScrollbarDragEdgeIntentMetrics(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
  ): ScrollFrameMetrics {
    const edgeIntent = this.deps.getScrollbarDragEdgeIntent()

    if (edgeIntent === 'before' && data.hasMoreBefore) {
      return {
        ...metrics,
        scrollTop: 0,
        distanceToBottom: Math.max(0, metrics.scrollHeight - metrics.clientHeight),
      }
    }

    if (edgeIntent === 'after' && data.hasMoreAfter) {
      return {
        ...metrics,
        scrollTop: Math.max(0, metrics.scrollHeight - metrics.clientHeight),
        distanceToBottom: 0,
      }
    }

    return metrics
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

  private maybeSlideWindow(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
  ): void {
    if (this.deps.getReadySubstate() === 'READY_MOTION_ACTIVE') {
      return
    }

    const snapshot = this.deps.store.getSnapshot()
    const edgeThresholdPx = this.deps.getEdgeThresholdPx(metrics)
    const nearTop = metrics.scrollTop < snapshot.topSpacer + edgeThresholdPx
    const nearBottom =
      metrics.distanceToBottom < snapshot.bottomSpacer + edgeThresholdPx

    if (!nearTop && !nearBottom) {
      return
    }

    const anchor = this.deps.anchor.captureViewportAnchor()

    if (!anchor) {
      this.enqueueAnchorlessWindowSlide(data, metrics, snapshot.renderWindow)
      return
    }

    const anchorIndex = this.deps.renderWindow.findIndexByKey(
      data.items,
      anchor.key,
    )

    if (anchorIndex < 0) {
      return
    }

    const nextWindow = this.deps.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex,
      viewportHeight: metrics.clientHeight,
      viewportWidth: metrics.clientWidth,
    })

    if (this.deps.projection.isRenderWindowEqual(snapshot.renderWindow, nextWindow)) {
      return
    }

    this.deps.transactions.enqueue(
      'resize',
      () =>
        this.deps.transactionController.runWindowSlideTransaction(
          anchor,
          nextWindow,
          {
            feedId: data.feedId,
            generation: data.generation,
            revision: data.revision,
          },
        ),
      'window-slide',
    )
  }

  private enqueueAnchorlessWindowSlide(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
    currentWindow: RenderWindow,
  ): void {
    const estimatedAnchorIndex = this.deps.renderWindow.findEstimatedIndexAtOffset(
      data.items,
      metrics.scrollTop + metrics.clientHeight / 2,
      metrics.clientWidth,
    )
    const nextWindow =
      estimatedAnchorIndex >= 0
        ? this.deps.renderWindow.computeWindowAroundAnchor({
            items: data.items,
            anchorIndex: estimatedAnchorIndex,
            viewportHeight: metrics.clientHeight,
            viewportWidth: metrics.clientWidth,
          })
        : null

    this.deps.emitDiagnostic({
      channel: 'anchor',
      severity: 'warn',
      name: 'anchor.captureMissing',
      correlationId:
        `data:${data.feedId}:${data.generation}:${this.deps.store.getSnapshot().revision}`,
      details: () => ({
        reason: 'window-slide',
        scrollTop: metrics.scrollTop,
        distanceToBottom: metrics.distanceToBottom,
        topSpacer: this.deps.store.getSnapshot().topSpacer,
        bottomSpacer: this.deps.store.getSnapshot().bottomSpacer,
        estimatedAnchorIndex,
      }),
    })

    if (
      nextWindow &&
      !this.deps.projection.isRenderWindowEqual(currentWindow, nextWindow)
    ) {
      this.deps.transactions.enqueue(
        'resize',
        () =>
          this.deps.runAnchorlessWindowSlideTransaction(nextWindow, {
            feedId: data.feedId,
            generation: data.generation,
            revision: data.revision,
          }),
        'window-slide',
      )
    }
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

export function readScrollFrameMetrics(
  container: HTMLElement,
): ScrollFrameMetrics {
  const scrollTop = container.scrollTop
  const clientHeight = container.clientHeight
  const scrollHeight = container.scrollHeight

  return {
    scrollTop,
    clientHeight,
    clientWidth: container.clientWidth,
    scrollHeight,
    distanceToBottom: Math.max(0, scrollHeight - scrollTop - clientHeight),
  }
}
