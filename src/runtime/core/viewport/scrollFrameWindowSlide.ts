import type { MessageDataSnapshot, RenderWindow } from '../../types'
import type { ScrollFrameMetrics } from '../state/runtimeTypes'
import type { ScrollFrameDeps } from './scrollFrameCoordinator'

export function maybeSlideWindow<TMessage, TOptimistic>(
  deps: ScrollFrameDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  metrics: ScrollFrameMetrics,
): void {
  if (deps.getReadySubstate() === 'READY_MOTION_ACTIVE') {
    return
  }

  const snapshot = deps.store.getSnapshot()
  const edgeThresholdPx = deps.getEdgeThresholdPx(metrics)
  const nearTop = metrics.scrollTop < snapshot.topSpacer + edgeThresholdPx
  const nearBottom =
    metrics.distanceToBottom < snapshot.bottomSpacer + edgeThresholdPx

  if (!nearTop && !nearBottom) {
    return
  }

  const anchor = deps.anchor.captureViewportAnchor()

  if (!anchor) {
    enqueueAnchorlessWindowSlide(deps, data, metrics, snapshot.renderWindow)
    return
  }

  const anchorIndex = deps.renderWindow.findIndexByKey(data.items, anchor.key)

  if (anchorIndex < 0) {
    return
  }

  const nextWindow = deps.renderWindow.computeWindowAroundAnchor({
    items: data.items,
    anchorIndex,
    viewportHeight: metrics.clientHeight,
    viewportWidth: metrics.clientWidth,
  })

  if (deps.projection.isRenderWindowEqual(snapshot.renderWindow, nextWindow)) {
    return
  }

  deps.transactions.enqueue(
    'resize',
    () =>
      deps.transactionController.runWindowSlideTransaction(
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

function enqueueAnchorlessWindowSlide<TMessage, TOptimistic>(
  deps: ScrollFrameDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  metrics: ScrollFrameMetrics,
  currentWindow: RenderWindow,
): void {
  const estimatedAnchorIndex = deps.renderWindow.findEstimatedIndexAtOffset(
    data.items,
    metrics.scrollTop + metrics.clientHeight / 2,
    metrics.clientWidth,
  )
  const nextWindow =
    estimatedAnchorIndex >= 0
      ? deps.renderWindow.computeWindowAroundAnchor({
          items: data.items,
          anchorIndex: estimatedAnchorIndex,
          viewportHeight: metrics.clientHeight,
          viewportWidth: metrics.clientWidth,
        })
      : null

  deps.emitDiagnostic({
    channel: 'anchor',
    severity: 'warn',
    name: 'anchor.captureMissing',
    correlationId:
      `data:${data.feedId}:${data.generation}:${deps.store.getSnapshot().revision}`,
    details: () => ({
      reason: 'window-slide',
      scrollTop: metrics.scrollTop,
      distanceToBottom: metrics.distanceToBottom,
      topSpacer: deps.store.getSnapshot().topSpacer,
      bottomSpacer: deps.store.getSnapshot().bottomSpacer,
      estimatedAnchorIndex,
    }),
  })

  if (nextWindow && !deps.projection.isRenderWindowEqual(currentWindow, nextWindow)) {
    deps.transactions.enqueue(
      'resize',
      () =>
        deps.runAnchorlessWindowSlideTransaction(nextWindow, {
          feedId: data.feedId,
          generation: data.generation,
          revision: data.revision,
        }),
      'window-slide',
    )
  }
}
