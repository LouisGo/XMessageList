import { getGeometryDiagnosticSeverity } from '../geometry/diagnostics/geometryDiagnostics'
import { computeRealRowCoverage } from '../geometry/measurement/coverage'
import { deriveCommittedMetrics } from '../transactions/geometryBuilder'
import type { SegmentRelayoutReason } from '../geometry/types'
import type {
  PendingPublication,
  RuntimeTransactionFlowContext,
} from './transactionFlow.types'

export function recordPhysicalWindowDiagnostic<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
  metrics: ReturnType<typeof deriveCommittedMetrics>,
): void {
  const mountedRowsHeight =
    pending.measuredRowsHeight ?? pending.publication.mountedRowsHeightEstimate
  const coverage = computeRealRowCoverage({
    topSpacer: pending.publication.topSpacer,
    mountedRowsHeight,
    clientHeight: ctx.dom.getViewportSize().clientHeight,
    scrollTop: metrics.scrollPosition,
  })
  const renderWindowStart =
    pending.publication.renderWindow.itemKeys[0] ?? null
  const renderWindowEnd =
    pending.publication.renderWindow.itemKeys.at(-1) ?? null

  ctx.diagnostics.record({
    kind: 'physical.windowSelected',
    severity: getGeometryDiagnosticSeverity('physical.windowSelected'),
    owner: 'geometry',
    message: 'physical geometry committed',
    viewport: {
      ...metrics,
      ts: Date.now(),
      renderWindowStart,
      renderWindowEnd,
      topSpacer: pending.publication.topSpacer,
      bottomSpacer: pending.publication.bottomSpacer,
      mountedRowsHeight,
      scrollTop: metrics.scrollPosition,
      scrollHeight: metrics.physicalWindowSize,
      clientHeight: ctx.dom.getViewportSize().clientHeight,
      physicalWindowHeight: pending.publication.physicalWindowHeight,
      realRowCoveragePx: coverage.realRowCoveragePx,
      minRealRowCoveragePx: coverage.minRealRowCoveragePx,
      bottomLockState: ctx.getBottomLockState(),
      viewportPhase: ctx.projection.getSnapshot().viewportPhase,
      dataRevision: ctx.data.requireSnapshot().revision,
    },
    details: {
      transactionId: pending.transaction.id,
      segmentId: pending.publication.segment.segmentId,
      segmentRevision: pending.publication.segment.segmentRevision,
    },
  })
}

export function recordPhysicalRelayoutDiagnostic<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
  reason: SegmentRelayoutReason,
): void {
  ctx.diagnostics.record({
    kind: 'physical.segmentRelayout',
    severity: getGeometryDiagnosticSeverity('physical.segmentRelayout'),
    owner: 'geometry',
    message: 'physical geometry requested segment relayout',
    details: {
      transactionId: pending.transaction.id,
      reason,
      segmentId: pending.publication.segment.segmentId,
      segmentRevision: pending.publication.segment.segmentRevision,
    },
  })
}
