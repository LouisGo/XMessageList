import type { MessageDataSnapshot } from '../../types'
import type { ScrollFrameMetrics } from '../state/runtimeTypes'
import type { ScrollFrameDeps } from './scrollFrameCoordinator'
import { readScrollFrameMetrics } from './scrollFrameMetrics'

export class ScrollbarDragEdgeCoordinator<TMessage, TOptimistic> {
  private recheckRaf: number | null = null

  constructor(private readonly deps: ScrollFrameDeps<TMessage, TOptimistic>) {}

  scheduleRecheck(reason: string): void {
    if (
      !this.deps.getScrollbarDragIntentActive() ||
      this.recheckRaf !== null
    ) {
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    this.recheckRaf = this.deps.scheduler.requestAnimationFrame(() => {
      this.recheckRaf = null
      this.incrementFrame()

      if (!this.deps.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.handleRecheckFrame(reason)
    })
  }

  cancelScheduledWork(): void {
    if (this.recheckRaf !== null) {
      this.deps.scheduler.cancelAnimationFrame(this.recheckRaf)
      this.recheckRaf = null
    }
  }

  updateEdgeIntent(
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

  private handleRecheckFrame(reason: string): void {
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
    const edgeMetrics = this.getEdgeIntentMetrics(data, metrics)
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
      this.deps.edge.emitScrollbarDragEdgeNeed({ data, edge: edgeIntent })
    }
    this.deps.setLastUserScrollTop(edgeMetrics.scrollTop)
    this.deps.setLastUserDistanceToBottom(edgeMetrics.distanceToBottom)
  }

  private getEdgeIntentMetrics(
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

  private incrementFrame(): void {
    this.deps.setCurrentFrame(this.deps.getCurrentFrame() + 1)
  }
}
