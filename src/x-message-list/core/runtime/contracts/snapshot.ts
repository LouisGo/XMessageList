import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from './identity'
import type { SegmentModifier } from './segment'

export type ProjectionCommitToken = {
  sessionId: string
  generation: number
  segmentRevision: number
  projectionRevision: number
}

export type EdgeSnapshotState = {
  status: 'idle' | 'loading' | 'error' | 'exhausted'
  latchToken?: string
  requestToken?: string
}

export type BottomLockState = 'LOCKED' | 'UNLOCKED'

export type PendingIntent =
  | 'edge-before'
  | 'edge-after'
  | 'underflow-fill'
  | 'follow-bottom'
  | 'destination'

export type ViewportPhase =
  | 'IDLE'
  | 'PROJECTING'
  | 'MEASURING'
  | 'CORRECTING'
  | 'MOTION'

export type ShortSegmentAlignment = 'start' | 'center' | 'end'

export type MessageListSnapshot<TMessage = unknown, TOptimistic = unknown> = {
  sessionId: string
  generation: number
  segmentRevision: number
  projectionRevision: number
  commitToken: ProjectionCommitToken
  items: MessageDataItem<TMessage, TOptimistic>[]
  segmentMeta: {
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    modifier: SegmentModifier
    anchor?: MessageIdentityAnchor
    anchorStatus?: 'normal' | 'deleted' | 'unavailable' | 'permission'
    shortSegmentAlignment: ShortSegmentAlignment
    underflow: 'unknown' | 'fillable' | 'settled'
  }
  edgeState: {
    before: EdgeSnapshotState
    after: EdgeSnapshotState
  }
  bottomLockState: BottomLockState
  pendingIntent: PendingIntent | null
  viewportPhase: ViewportPhase
}

export type ViewportEvidence = {
  sessionId: string
  generation: number
  segmentRevision: number
  projectionRevision: number
  commitToken: ProjectionCommitToken | null
  modifier: SegmentModifier['type']
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  bottomLockState: BottomLockState
  pendingIntent: PendingIntent | null
  shortSegmentAlignment: ShortSegmentAlignment
  scrollTop: number
  clientHeight: number
  scrollHeight: number
  visibleRows: Array<{
    key: MessageRuntimeItemKey
    stableId?: string
    serverId?: string
    rowKind: string
    top: number
    bottom: number
  }>
  beforeTrigger: DOMRectLike
  afterTrigger: DOMRectLike
  bottomMarker: DOMRectLike | null
  phase: ViewportPhase
  edgeState: MessageListSnapshot['edgeState']
}

export type DOMRectLike = {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

export type MessageListSnapshotListener = () => void
