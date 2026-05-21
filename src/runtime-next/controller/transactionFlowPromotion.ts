import type { MessageDataSnapshot } from '../data/types'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import { deriveCommittedMetrics } from '../transactions/geometryBuilder'
import type { GeometryBuildPlan } from '../transactions/geometryBuilder.types'
import type { RuntimeTransaction } from '../transactions/types'
import type { PendingGeometryProjection } from '../geometry/publication/publication.types'
import type { SegmentRelayoutReason } from '../geometry/types'
import {
  bootstrapStateAfterCommit,
  bootstrapStateForPublish,
  edgeStateFromSnapshot,
  phaseForTransaction,
} from './controllerHelpers'
import { resolveBottomLockState } from './bottomLock'
import { decidePromotionCorrection } from './transactionPromoter'
import {
  recordPhysicalRelayoutDiagnostic,
  recordPhysicalWindowDiagnostic,
} from './transactionFlowDiagnostics'
import { emitDestinationSettled } from './transactionFlowDestination'
import { resolveTransactionScrollTop } from './transactionFlowScroll'
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
  if (
    decision.correction.kind === 'segment-relayout' ||
    decision.correction.topDelta !== 0 ||
    decision.correction.bottomDelta !== 0
  ) {
    ctx.enqueue({
      kind: 'segmentRelayout',
      reason: decision.correction.kind === 'segment-relayout'
        ? decision.correction.reason
        : 'measurement',
    })
  }
  ctx.finish(pending.transaction.id)
}

export type GeometryCommitEvaluation<TMessage, TOptimistic> =
  | {
      readonly kind: 'ready'
      readonly pending: PendingPublication<TMessage, TOptimistic>
    }
  | {
      readonly kind: 'await-correction'
      readonly pending: PendingPublication<TMessage, TOptimistic>
    }
  | {
      readonly kind: 'segment-relayout'
      readonly reason: SegmentRelayoutReason
    }

export function evaluateGeometryCommit<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
): GeometryCommitEvaluation<TMessage, TOptimistic> {
  const measurement = ctx.dom.measureRows(
    pending.publication.renderWindow.itemKeys,
  )
  const measuredPending: PendingPublication<TMessage, TOptimistic> = {
    ...pending,
    measuredRowsHeight: measurement.mountedRowsHeight > 0
      ? measurement.mountedRowsHeight
      : pending.publication.mountedRowsHeightEstimate,
    measuredRowHeights: measurement.measuredRowHeights,
  }
  const promotion = decidePromotionCorrection({
    publication: pending.publication,
    dataRevision: ctx.data.requireSnapshot().revision,
    scrollTop: resolveTransactionScrollTop(
      ctx,
      measuredPending,
    ),
    clientHeight: ctx.dom.getViewportSize().clientHeight,
    measuredRowsHeight: measurement.mountedRowsHeight,
    previousMetrics: ctx.metrics.getMetrics(),
    previousCorrections: [],
  })
  if (promotion.correction.kind === 'segment-relayout') {
    recordPhysicalRelayoutDiagnostic(ctx, pending, promotion.correction.reason)
    return {
      kind: 'segment-relayout',
      reason: promotion.correction.reason,
    }
  }

  const topSpacer = pending.publication.topSpacer + promotion.correction.topDelta
  const bottomSpacer =
    pending.publication.bottomSpacer + promotion.correction.bottomDelta
  const correctedPending: PendingPublication<TMessage, TOptimistic> = {
    ...measuredPending,
    measuredRowsHeight: promotion.mountedRowsHeight,
    publication: {
      ...pending.publication,
      topSpacer,
      bottomSpacer,
    },
  }

  if (
    promotion.correction.topDelta === 0 &&
    promotion.correction.bottomDelta === 0
  ) {
    return {
      kind: 'ready',
      pending: correctedPending,
    }
  }

  return publishCorrectionProjection(ctx, correctedPending)
}

export function promoteGeometry<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
  segment: PhysicalSegment,
  scrollTop: number,
): void {
  const metrics = deriveCommittedMetrics({
    segmentId: segment.segmentId,
    segmentRevision: segment.segmentRevision,
    renderWindowStart: pending.publication.renderWindow.itemKeys[0] ?? null,
    renderWindowEnd: pending.publication.renderWindow.itemKeys.at(-1) ?? null,
    topSpacer: pending.publication.topSpacer,
    bottomSpacer: pending.publication.bottomSpacer,
    mountedRowsHeight:
      pending.measuredRowsHeight ?? pending.publication.mountedRowsHeightEstimate,
    naturalBlankHeight: pending.publication.naturalBlankHeight,
    physicalWindowHeight: pending.publication.physicalWindowHeight,
    scrollHeightCap: segment.scrollHeightCap,
    capMode: segment.capMode,
    viewportSize: ctx.dom.getViewportSize(),
    domScrollHeight: ctx.dom.getDomScrollHeight(
      pending.publication.physicalWindowHeight,
    ),
    scrollTop,
    flags: ctx.resolveScrollFlagsForPromotion(pending.transaction, segment),
  })
  ctx.runner.markMeasurementCorrection(pending.transaction.id)
  ctx.metrics.promote(metrics)
  ctx.setBottomLockState(resolveBottomLockState({
    data: ctx.data.requireSnapshot(),
    segment,
    metrics,
    hasSegmentShiftInFlight:
      metrics.isSegmentShiftPending || metrics.isSegmentShifting,
    allowLock: pending.promotesBottomLock,
  }))
  ctx.projection.publish({
    revision: pending.publication.commitToken.projectionRevision,
    commitToken: pending.publication.commitToken,
    items: pending.publication.items,
    renderWindow: pending.publication.renderWindow,
    topSpacer: pending.publication.topSpacer,
    bottomSpacer: pending.publication.bottomSpacer,
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
  recordPhysicalWindowDiagnostic(ctx, pending, metrics)
  ctx.runner.markMetricsPromoted(pending.transaction.id)
  emitDestinationSettled(ctx, pending.transaction)
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

export function restoreStableProjection<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
): void {
  ctx.projection.restore(pending.stableSnapshot)
}

function publishCorrectionProjection<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
): GeometryCommitEvaluation<TMessage, TOptimistic> {
  const commitToken = {
    ...pending.publication.commitToken,
    projectionRevision: ctx.projection.getSnapshot().revision + 1,
  }
  if (!ctx.revision.replacePendingCommitToken({
    expected: pending.publication.commitToken,
    next: commitToken,
  })) {
    return {
      kind: 'segment-relayout',
      reason: 'measurement',
    }
  }
  const publication = {
    ...pending.publication,
    commitToken,
  }
  const correctionPending: PendingPublication<TMessage, TOptimistic> = {
    ...pending,
    phase: 'correction',
    measuredRowsHeight:
      pending.measuredRowsHeight ??
      pending.publication.mountedRowsHeightEstimate,
    measuredRowHeights: pending.measuredRowHeights,
    publication,
  }

  // Measurement correction changes DOM spacers, so it needs its own projection ack
  // before the corrected physical metrics can become committed.
  publishPending(
    ctx,
    publication,
    pending.transaction,
    ctx.data.requireSnapshot(),
  )

  return {
    kind: 'await-correction',
    pending: correctionPending,
  }
}
