import type { MessageDataSnapshot } from '../data/types'
import type {
  AnchorState,
  MessageIdentityAnchor,
  RuntimeNextTransactionId,
} from '../identity/types'
import type { ProjectionCommitToken } from '../projection/types'
import type { SegmentRelayoutReason, SegmentShiftDirection } from '../geometry/types'
import type { ViewportTransactionKind } from '../commands/types'

export type TransactionLifecycleStage =
  | 'queued'
  | 'running'
  | 'projection-published'
  | 'commit-ack'
  | 'measurement-correction'
  | 'metrics-promoted'
  | 'aborted'

export type TransactionAbortReason =
  | 'replaced'
  | 'detach'
  | 'destroy'
  | 'timeout'
  | 'commit-token-mismatch'
  | 'missing-data'
  | 'writer-denied'
  | 'error'

export type DataArrivalIntentKind =
  | 'projectionRefresh'
  | 'segmentRelayout'
  | 'segmentShift'
  | 'followBottom'
  | 'jump'
  | 'restore'
  | 'reset'
  | 'no-op'

export type DataArrivalIntent =
  | { readonly kind: 'projectionRefresh' }
  | { readonly kind: 'segmentRelayout'; readonly reason: SegmentRelayoutReason }
  | { readonly kind: 'segmentShift'; readonly direction: SegmentShiftDirection }
  | { readonly kind: 'followBottom' }
  | { readonly kind: 'jump'; readonly target: MessageIdentityAnchor }
  | { readonly kind: 'restore'; readonly target: MessageIdentityAnchor | AnchorState }
  | { readonly kind: 'reset'; readonly reason: string }
  | { readonly kind: 'no-op'; readonly reason: string }

export type RuntimeTransactionIntent<TMessage = unknown, TOptimistic = unknown> =
  | {
      readonly kind: 'bootstrap'
      readonly mode: 'latest' | 'unread' | 'restored'
      readonly target?: MessageIdentityAnchor | AnchorState
      readonly temporaryUnreadFallback?: boolean
    }
  | { readonly kind: 'projectionRefresh' }
  | { readonly kind: 'segmentRelayout'; readonly reason: SegmentRelayoutReason }
  | {
      readonly kind: 'segmentShift'
      readonly direction: SegmentShiftDirection
      readonly source?: 'edge' | 'drag-handoff' | 'wheel' | 'keyboard' | 'data'
    }
  | { readonly kind: 'jump'; readonly target: MessageIdentityAnchor }
  | { readonly kind: 'restore'; readonly target: MessageIdentityAnchor | AnchorState }
  | { readonly kind: 'followBottom' }
  | { readonly kind: 'reset'; readonly reason: string }
  | {
      readonly kind: 'dataArrival'
      readonly snapshot: MessageDataSnapshot<TMessage, TOptimistic>
    }

export type RuntimeTransaction<TMessage = unknown, TOptimistic = unknown> = {
  readonly id: RuntimeNextTransactionId
  readonly kind: ViewportTransactionKind | 'dataArrival'
  readonly intent: RuntimeTransactionIntent<TMessage, TOptimistic>
  readonly stage: TransactionLifecycleStage
  readonly queuedAt: number
  readonly startedAt?: number
  readonly commitToken?: ProjectionCommitToken
  readonly abortReason?: TransactionAbortReason
}

export type TransactionStageRecord<TMessage = unknown, TOptimistic = unknown> = {
  readonly transaction: RuntimeTransaction<TMessage, TOptimistic>
  readonly previousStage: TransactionLifecycleStage | null
}
