import type {
  MessageRuntimeItemKey,
  RuntimeNextRevision,
  RuntimeNextSegmentId,
  RuntimeNextTransactionId,
} from '../../identity/types'
import type { ProjectionCommitToken } from '../../projection/types'
import type {
  PhysicalSegmentCapMode,
  SegmentRelayoutReason,
} from '../types'

export type PhysicalSegmentRole =
  | 'history'
  | 'latest'
  | 'target'
  | 'short-feed'

export type PhysicalSegment = {
  readonly segmentId: RuntimeNextSegmentId
  readonly segmentRevision: RuntimeNextRevision
  readonly logicalSegmentId: string
  readonly logicalAnchorKey: MessageRuntimeItemKey
  readonly logicalStartItemKey: MessageRuntimeItemKey
  readonly logicalEndItemKey: MessageRuntimeItemKey
  readonly renderWindowStartKey: MessageRuntimeItemKey
  readonly renderWindowEndKey: MessageRuntimeItemKey
  readonly logicalRole: PhysicalSegmentRole
  readonly estimatedRowsHeight: number
  readonly physicalWindowHeight: number
  readonly scrollHeightCap: number
  readonly capMode: PhysicalSegmentCapMode
}

export type PhysicalSegmentDraft =
  Omit<PhysicalSegment, 'segmentId' | 'segmentRevision'> & {
    readonly segmentId?: RuntimeNextSegmentId
  }

export type PhysicalSegmentRevisionReason =
  | 'bootstrap'
  | 'segmentRelayout'
  | 'capFallback'
  | 'shortFeedModeChange'
  | 'exceptionalRowCap'

export type PhysicalSegmentRevisionStatus =
  | 'idle'
  | 'pending'

export type PendingPhysicalSegmentRevision = {
  readonly status: 'pending'
  readonly reason: PhysicalSegmentRevisionReason
  readonly segment: PhysicalSegment
  readonly previousSegment: PhysicalSegment | null
  readonly commitToken: ProjectionCommitToken
  readonly transactionId: RuntimeNextTransactionId
  readonly allocatedAt: number
  readonly relayoutReason?: SegmentRelayoutReason
}

export type PhysicalSegmentRevisionSnapshot = {
  readonly status: PhysicalSegmentRevisionStatus
  readonly committedSegment: PhysicalSegment | null
  readonly pendingSegment: PhysicalSegment | null
  readonly lastCommitToken: ProjectionCommitToken | null
  readonly nextSegmentRevision: RuntimeNextRevision
  readonly nextSegmentSequence: number
}
