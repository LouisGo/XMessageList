import type { SegmentRelayoutReason } from '../types'
import type { PhysicalSegmentCapMode } from '../types'

export type MeasurementHeightDelta = {
  readonly deltaPx: number
}

export type MeasurementHeightFact = {
  readonly previousHeightPx: number
  readonly measuredHeightPx: number
}

export type SpacerCorrectionMode = 'bottom-first' | 'top-first'

export type MeasurementGeometrySnapshot = {
  readonly physicalSegmentRevision: number
  readonly dataRevision: number
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly mountedRowsHeight: number
  readonly physicalWindowHeight: number
  readonly scrollHeightCap: number
  readonly capMode: PhysicalSegmentCapMode
  readonly clientHeight: number
  readonly scrollTop: number
  readonly minRealRowCoveragePx?: number
}

export type SpacerCorrectionHistoryEntry = {
  readonly physicalSegmentRevision: number
  readonly dataRevision: number
  readonly topDelta: number
  readonly bottomDelta: number
}

export type MeasurementCorrectionInput = {
  readonly current: MeasurementGeometrySnapshot
  readonly deltas?: readonly MeasurementHeightDelta[]
  readonly facts?: readonly MeasurementHeightFact[]
  readonly previousCorrections?: readonly SpacerCorrectionHistoryEntry[]
  readonly spacerCorrectionMode?: SpacerCorrectionMode
}

export type MeasurementCorrectionDecision =
  | {
      readonly kind: 'local-spacer-correction'
      readonly topDelta: number
      readonly bottomDelta: number
    }
  | {
      readonly kind: 'segment-relayout'
      readonly reason: SegmentRelayoutReason
    }
