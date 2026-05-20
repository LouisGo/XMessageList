import type {
  PendingGeometryProjection,
} from '../geometry/publication/publication.types'
import { decideMeasurementCorrection } from '../geometry/measurement/measurementCorrection'
import type {
  MeasurementCorrectionDecision,
  MeasurementGeometrySnapshot,
  SpacerCorrectionHistoryEntry,
} from '../geometry/measurement/measurementCorrection.types'
import type { PhysicalScrollMetrics } from '../geometry/types'

export type MeasurementPromotionInput<TMessage = unknown, TOptimistic = unknown> = {
  readonly publication: PendingGeometryProjection<TMessage, TOptimistic>
  readonly dataRevision: number
  readonly scrollTop: number
  readonly clientHeight: number
  readonly measuredRowsHeight: number
  readonly previousMetrics: PhysicalScrollMetrics
  readonly previousCorrections: readonly SpacerCorrectionHistoryEntry[]
}

export type MeasurementPromotionDecision = {
  readonly correction: MeasurementCorrectionDecision
  readonly mountedRowsHeight: number
}

export function decidePromotionCorrection<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  input: MeasurementPromotionInput<TMessage, TOptimistic>,
): MeasurementPromotionDecision {
  const baselineMountedRowsHeight = input.publication.mountedRowsHeightEstimate
  const mountedRowsHeight =
    input.measuredRowsHeight > 0
      ? input.measuredRowsHeight
      : baselineMountedRowsHeight
  const facts = input.measuredRowsHeight > 0
    ? [{
        previousHeightPx: baselineMountedRowsHeight,
        measuredHeightPx: input.measuredRowsHeight,
      }]
    : []
  const current: MeasurementGeometrySnapshot = {
    physicalSegmentRevision: input.publication.commitToken.segmentRevision,
    dataRevision: input.dataRevision,
    topSpacer: input.publication.topSpacer,
    bottomSpacer: input.publication.bottomSpacer,
    mountedRowsHeight: baselineMountedRowsHeight,
    physicalWindowHeight: input.publication.physicalWindowHeight,
    scrollHeightCap: input.publication.segment.scrollHeightCap,
    capMode: input.publication.segment.capMode,
    scrollTop: input.scrollTop,
    clientHeight: input.clientHeight,
    minRealRowCoveragePx: input.clientHeight,
  }

  return {
    correction: decideMeasurementCorrection({
      current,
      deltas: [],
      facts,
      previousCorrections: input.previousCorrections,
    }),
    mountedRowsHeight,
  }
}
