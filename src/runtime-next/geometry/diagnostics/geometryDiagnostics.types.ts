import type { MessageRuntimeItemKey } from '../../identity/types'
import type { PhysicalCoverageResult } from '../measurement/coverage.types'
import type {
  PhysicalSegmentCapMode,
  SegmentRelayoutReason,
} from '../types'

export type GeometryDiagnosticSeverity = 'info' | 'warn' | 'error'

export type GeometryDiagnosticKind =
  | 'physical.windowSelected'
  | 'physical.segmentRelayout'
  | 'physical.scrollHeightExceededCap'
  | 'physical.spacerOnlyViewport'
  | 'physical.realRowCoverageInsufficient'
  | 'physical.spacerOscillationSameRevision'
  | 'physical.capExceededByRow'

export type GeometryDiagnosticPayload = {
  readonly dataRevision: number
  readonly physicalSegmentId: string | null
  readonly physicalSegmentRevision: number
  readonly renderWindowStart: MessageRuntimeItemKey | null
  readonly renderWindowEnd: MessageRuntimeItemKey | null
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly mountedRowsHeight: number
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly domScrollHeight: number
  readonly clientHeight: number
  readonly physicalWindowHeight: number
  readonly maxScrollPosition: number
  readonly scrollHeightCap: number
  readonly capMode: PhysicalSegmentCapMode
  readonly safeScrollRangeStart: number
  readonly safeScrollRangeEnd: number
  readonly realRowCoveragePx: number
  readonly minRealRowCoveragePx: number
}

export type GeometryDiagnosticPayloadInput = {
  readonly dataRevision: number
  readonly physicalSegmentId: string | null
  readonly physicalSegmentRevision: number
  readonly renderWindowStart: MessageRuntimeItemKey | null
  readonly renderWindowEnd: MessageRuntimeItemKey | null
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly mountedRowsHeight: number
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly domScrollHeight: number
  readonly clientHeight: number
  readonly physicalWindowHeight: number
  readonly scrollHeightCap: number
  readonly capMode: PhysicalSegmentCapMode
  readonly coverage: Pick<
    PhysicalCoverageResult,
    | 'safeScrollRangeStart'
    | 'safeScrollRangeEnd'
    | 'realRowCoveragePx'
    | 'minRealRowCoveragePx'
  >
}

export type GeometryDiagnosticRecord = {
  readonly id: string
  readonly ts: number
  readonly kind: GeometryDiagnosticKind
  readonly severity: GeometryDiagnosticSeverity
  readonly payload: GeometryDiagnosticPayload
  readonly details?: Readonly<Record<string, unknown>>
}

export type CreateGeometryDiagnosticInput = {
  readonly kind: GeometryDiagnosticKind
  readonly payload: GeometryDiagnosticPayloadInput
  readonly id?: string
  readonly severity?: GeometryDiagnosticSeverity
  readonly details?: Readonly<Record<string, unknown>>
  readonly now?: () => number
}

export type CreateSegmentRelayoutDiagnosticInput =
  Omit<CreateGeometryDiagnosticInput, 'kind' | 'details'> & {
    readonly reason: SegmentRelayoutReason
  }
