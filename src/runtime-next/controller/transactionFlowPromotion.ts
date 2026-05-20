import type { MessageDataSnapshot } from '../data/types'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import { deriveCommittedMetrics } from '../transactions/geometryBuilder'
import type { GeometryBuildPlan } from '../transactions/geometryBuilder.types'
import type { RuntimeTransaction } from '../transactions/types'
import type { PendingGeometryProjection } from '../geometry/publication/publication.types'
import type { ScrollWriterKind } from '../scroll/writerArbitration'
import {
  bootstrapStateAfterCommit,
  bootstrapStateForPublish,
  edgeStateFromSnapshot,
  phaseForTransaction,
} from './controllerHelpers'
import { decidePromotionCorrection } from './transactionPromoter'
import type {
  PendingPublication,
  RuntimeTransactionFlowContext,
} from './transactionFlow.types'

export function publishPending<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  publication: PendingGeometryProjection<TMessage, TOptimistic>,
  transaction: RuntimeTransaction<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
): void {
  ctx.projection.publish({
    revision: publication.commitToken.projectionRevision,
    commitToken: publication.commitToken,
    items: publication.items,
    renderWindow: publication.renderWindow,
    topSpacer: publication.topSpacer,
    bottomSpacer: publication.bottomSpacer,
    naturalBlankHeight: publication.naturalBlankHeight,
    bottomLockState: ctx.getBottomLockState(),
    bootstrapState: bootstrapStateForPublish(
      transaction.kind,
      ctx.projection.getSnapshot().bootstrapState,
    ),
    viewportPhase: phaseForTransaction(transaction.kind),
    edgeState: edgeStateFromSnapshot(data),
  })
  ctx.runner.markProjectionPublished(transaction.id, publication.commitToken)
  ctx.armAckTimeout(transaction.id)
}

export function completeProjectionRefresh<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
): void {
  const measurement = ctx.dom.measureRows(
    pending.publication.renderWindow.itemKeys,
  )
  const decision = decidePromotionCorrection({
    publication: pending.publication,
    dataRevision: ctx.data.requireSnapshot().revision,
    scrollTop: ctx.getCurrentScrollTop(),
    clientHeight: ctx.dom.getViewportSize().clientHeight,
    measuredRowsHeight: measurement.mountedRowsHeight,
    previousMetrics: ctx.metrics.getMetrics(),
    previousCorrections: [],
  })
  ctx.runner.markMeasurementCorrection(pending.transaction.id)
  ctx.runner.markMetricsPromoted(pending.transaction.id)
  if (decision.correction.kind === 'segment-relayout') {
    ctx.enqueue({
      kind: 'segmentRelayout',
      reason: decision.correction.reason,
    })
  }
  ctx.finish(pending.transaction.id)
}

export function promoteGeometry<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
  segment: PhysicalSegment,
): void {
  const measurement = ctx.dom.measureRows(
    pending.publication.renderWindow.itemKeys,
  )
  const promotion = decidePromotionCorrection({
    publication: pending.publication,
    dataRevision: ctx.data.requireSnapshot().revision,
    scrollTop: ctx.getCurrentScrollTop(),
    clientHeight: ctx.dom.getViewportSize().clientHeight,
    measuredRowsHeight: measurement.mountedRowsHeight,
    previousMetrics: ctx.metrics.getMetrics(),
    previousCorrections: [],
  })
  if (promotion.correction.kind === 'segment-relayout') {
    ctx.abort('error')
    ctx.enqueue({
      kind: 'segmentRelayout',
      reason: promotion.correction.reason,
    })
    return
  }

  const topSpacer = pending.publication.topSpacer + promotion.correction.topDelta
  const bottomSpacer =
    pending.publication.bottomSpacer + promotion.correction.bottomDelta
  const scrollTop = writeTransactionScrollTop(ctx, pending)
  const metrics = deriveCommittedMetrics({
    segmentId: segment.segmentId,
    segmentRevision: segment.segmentRevision,
    renderWindowStart: pending.publication.renderWindow.itemKeys[0] ?? null,
    renderWindowEnd: pending.publication.renderWindow.itemKeys.at(-1) ?? null,
    topSpacer,
    bottomSpacer,
    mountedRowsHeight: promotion.mountedRowsHeight,
    naturalBlankHeight: pending.publication.naturalBlankHeight,
    physicalWindowHeight: pending.publication.physicalWindowHeight,
    scrollHeightCap: segment.scrollHeightCap,
    capMode: segment.capMode,
    viewportSize: ctx.dom.getViewportSize(),
    scrollTop,
  })
  ctx.runner.markMeasurementCorrection(pending.transaction.id)
  ctx.metrics.promote(metrics)
  ctx.setBottomLockState(pending.promotesBottomLock ? 'LOCKED' : 'UNLOCKED')
  ctx.projection.publish({
    revision: pending.publication.commitToken.projectionRevision,
    commitToken: pending.publication.commitToken,
    items: pending.publication.items,
    renderWindow: pending.publication.renderWindow,
    topSpacer,
    bottomSpacer,
    naturalBlankHeight: pending.publication.naturalBlankHeight,
    bottomLockState: ctx.getBottomLockState(),
    bootstrapState: bootstrapStateAfterCommit(
      pending.transaction.kind,
      ctx.data.requireSnapshot(),
      ctx.projection.getSnapshot().bootstrapState,
    ),
    viewportPhase: 'IDLE',
    edgeState: ctx.projection.getSnapshot().edgeState,
  })
  ctx.runner.markMetricsPromoted(pending.transaction.id)
  ctx.finish(pending.transaction.id)
}

export function planFromPublication<TMessage, TOptimistic>(
  publication: PendingGeometryProjection<TMessage, TOptimistic>,
): GeometryBuildPlan<TMessage, TOptimistic> {
  return {
    segment: publication.segment,
    items: publication.items,
    renderWindow: publication.renderWindow,
    topSpacer: publication.topSpacer,
    bottomSpacer: publication.bottomSpacer,
    naturalBlankHeight: publication.naturalBlankHeight,
    physicalWindowHeight: publication.physicalWindowHeight,
    mountedRowsHeightEstimate: publication.mountedRowsHeightEstimate,
    role: publication.segment.logicalRole,
    capMode: publication.segment.capMode,
  }
}

function writeTransactionScrollTop<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
): number {
  const kind = pending.transaction.kind
  const maxTop = Math.max(
    0,
    pending.publication.physicalWindowHeight -
      ctx.dom.getViewportSize().clientHeight,
  )
  const desired = kind === 'followBottom'
    ? maxTop
    : kind === 'segmentShift'
      ? Math.min(maxTop, ctx.dom.getViewportSize().clientHeight)
      : ctx.getCurrentScrollTop()
  if (desired === ctx.getCurrentScrollTop()) return desired

  const writerKind: ScrollWriterKind = kind === 'followBottom'
    ? 'follow-bottom'
    : kind === 'segmentShift'
      ? 'segment-shift-rebase'
      : 'anchor-correction'
  const token = { transactionId: pending.transaction.id, kind: writerKind }
  if (!ctx.writer.acquire(token).acquired) {
    ctx.diagnostics.record({
      kind: 'writer-arbitration',
      severity: 'warn',
      owner: 'scroll',
      message: 'transaction writer denied',
    })
    return ctx.getCurrentScrollTop()
  }
  if (ctx.writer.writeScrollTop(ctx.dom.getContainer(), desired, token)) {
    ctx.setCurrentScrollTop(desired)
  }
  ctx.writer.release(token)
  return ctx.getCurrentScrollTop()
}
