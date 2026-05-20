import type {
  MessageRuntimeItemKey,
} from '../identity/types'
import type {
  BottomLockState,
  ViewportPhase,
} from '../projection/types'

export type PhysicalSegmentCapMode =
  | 'normal'
  | 'short-feed'
  | 'exceptional-row'

export type SegmentRelayoutReason =
  | 'resize'
  | 'measurement'
  | 'coverage-risk'
  | 'cap-exceeded'
  | 'cap-fallback'
  | 'spacer-oscillation'
  | 'bootstrap-stabilization'

export type SegmentRelayoutState = 'idle' | 'pending' | 'running'
export type SegmentShiftDirection = 'before' | 'after'
export type AdjacentPrefetchState = 'idle' | 'needed' | 'in-flight' | 'ready'

export type PhysicalScrollMetrics = {
  readonly physicalSegmentId: string | null
  readonly physicalSegmentRevision: number
  readonly viewportSize: number
  readonly physicalWindowSize: number
  readonly domScrollHeight: number
  readonly scrollPosition: number
  readonly maxScrollPosition: number
  readonly scrollHeightCap: number
  readonly capMode: PhysicalSegmentCapMode
  readonly safeScrollRangeStart: number
  readonly safeScrollRangeEnd: number
  readonly isDragLocked: boolean
  readonly isThumbFrozen: boolean
  readonly isSegmentShiftPending: boolean
  readonly pendingShiftDirection: SegmentShiftDirection | null
  readonly pendingEdgeOverflowPx: number
  readonly isSegmentShifting: boolean
  readonly isMomentumLatched: boolean
  readonly suppressedMomentumDeltaPx: number
  readonly segmentRelayoutState: SegmentRelayoutState
  readonly segmentRelayoutReason: SegmentRelayoutReason | null
  readonly adjacentPrefetchBefore: AdjacentPrefetchState
  readonly adjacentPrefetchAfter: AdjacentPrefetchState
}

export type ViewportDiagnostics = PhysicalScrollMetrics & {
  readonly ts: number
  readonly renderWindowStart: MessageRuntimeItemKey | null
  readonly renderWindowEnd: MessageRuntimeItemKey | null
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly mountedRowsHeight: number
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly physicalWindowHeight: number
  readonly realRowCoveragePx: number
  readonly minRealRowCoveragePx: number
  readonly bottomLockState: BottomLockState
  readonly viewportPhase: ViewportPhase
  readonly dataRevision: number
}
