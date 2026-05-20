import type { MessageDataSnapshot } from '../data/types'
import type {
  AnchorState,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../identity/types'
import type {
  MessageDataItem,
  RenderWindow,
} from '../projection/types'
import type { PhysicalSegmentDraft, PhysicalSegmentRole } from '../geometry/segment/physicalSegment.types'
import type { PhysicalSegmentCapMode, PhysicalScrollMetrics } from '../geometry/types'
import type { RuntimeViewportSize } from '../dom/domRegistry'

export type GeometryBuildKind =
  | 'bootstrap'
  | 'segmentRelayout'
  | 'segmentShift'
  | 'jump'
  | 'restore'
  | 'followBottom'
  | 'reset'

export type GeometryBuildInput<TMessage = unknown, TOptimistic = unknown> = {
  readonly kind: GeometryBuildKind
  readonly data: MessageDataSnapshot<TMessage, TOptimistic>
  readonly viewportSize: RuntimeViewportSize
  readonly currentScrollTop: number
  readonly target?: MessageIdentityAnchor | AnchorState
  readonly direction?: 'before' | 'after'
  readonly currentSegment?: PhysicalSegmentDraft & {
    readonly segmentId: string
    readonly segmentRevision: number
  }
}

export type GeometryBuildPlan<TMessage = unknown, TOptimistic = unknown> = {
  readonly segment: PhysicalSegmentDraft
  readonly items: readonly MessageDataItem<TMessage, TOptimistic>[]
  readonly renderWindow: RenderWindow
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly naturalBlankHeight: number
  readonly physicalWindowHeight: number
  readonly mountedRowsHeightEstimate: number
  readonly role: PhysicalSegmentRole
  readonly capMode: PhysicalSegmentCapMode
}

export type MetricsDerivationInput = {
  readonly segmentId: string
  readonly segmentRevision: number
  readonly renderWindowStart: MessageRuntimeItemKey | null
  readonly renderWindowEnd: MessageRuntimeItemKey | null
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly mountedRowsHeight: number
  readonly naturalBlankHeight: number
  readonly physicalWindowHeight: number
  readonly scrollHeightCap: number
  readonly capMode: PhysicalSegmentCapMode
  readonly viewportSize: RuntimeViewportSize
  readonly scrollTop: number
  readonly flags?: Partial<Pick<
    PhysicalScrollMetrics,
    | 'isDragLocked'
    | 'isThumbFrozen'
    | 'isSegmentShiftPending'
    | 'pendingShiftDirection'
    | 'pendingEdgeOverflowPx'
    | 'isSegmentShifting'
    | 'isMomentumLatched'
    | 'suppressedMomentumDeltaPx'
    | 'segmentRelayoutState'
    | 'segmentRelayoutReason'
    | 'adjacentPrefetchBefore'
    | 'adjacentPrefetchAfter'
  >>
}
