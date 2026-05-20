import type {
  MessageRuntimeItemKey,
  RuntimeNextFeedId,
  RuntimeNextGeneration,
  RuntimeNextRevision,
  RuntimeNextSegmentId,
  RuntimeNextTransactionId,
} from '../identity/types'

export type ProjectionCommitToken = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
  readonly projectionRevision: RuntimeNextRevision
  readonly segmentId: RuntimeNextSegmentId
  readonly segmentRevision: RuntimeNextRevision
  readonly transactionId: RuntimeNextTransactionId
}

export type ProjectionCommit = ProjectionCommitToken

export type CommittedMessageDataItem<TMessage = unknown> = {
  readonly kind: 'committed'
  readonly key: Extract<MessageRuntimeItemKey, { kind: 'committed' }>
  readonly message: TMessage
  readonly version: number
  readonly contentVersion?: number
  readonly estimatedHeight?: number
}

export type OptimisticMessageDataItem<TOptimistic = unknown> = {
  readonly kind: 'optimistic'
  readonly key: Extract<MessageRuntimeItemKey, { kind: 'optimistic' }>
  readonly draft: TOptimistic
  readonly status: 'sending' | 'failed'
  readonly version: number
  readonly contentVersion?: number
  readonly estimatedHeight?: number
}

export type TombstoneMessageDataItem = {
  readonly kind: 'tombstone'
  readonly key: Extract<MessageRuntimeItemKey, { kind: 'committed' }>
  readonly reason: 'deleted' | 'unavailable'
  readonly version: number
  readonly estimatedHeight?: number
}

export type MessageDataItem<TMessage = unknown, TOptimistic = unknown> =
  | CommittedMessageDataItem<TMessage>
  | OptimisticMessageDataItem<TOptimistic>
  | TombstoneMessageDataItem

export type RenderWindow = {
  readonly startIndex: number
  readonly endIndex: number
  readonly itemKeys: readonly MessageRuntimeItemKey[]
}

export type BottomLockState = 'LOCKED' | 'UNLOCKED'

export type BootstrapState =
  | 'INITIAL'
  | 'MOUNTING'
  | 'MEASURING'
  | 'STABILIZING'
  | 'READY'
  | 'READY_EMPTY'

export type ViewportPhase =
  | 'IDLE'
  | 'RECOVERING'
  | 'SEGMENT_SHIFTING'
  | 'DESTINATION_PENDING'
  | 'MOTION_ACTIVE'

export type ViewportEdgeStatus = 'idle' | 'loading' | 'exhausted' | 'error'

export type ViewportEdgeState = {
  readonly before: ViewportEdgeStatus
  readonly after: ViewportEdgeStatus
}

export type MessageViewportSnapshot<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
  readonly revision: RuntimeNextRevision
  readonly commitToken: ProjectionCommitToken
  readonly items: readonly MessageDataItem<TMessage, TOptimistic>[]
  readonly renderWindow: RenderWindow
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly naturalBlankHeight: number
  readonly bottomLockState: BottomLockState
  readonly bootstrapState: BootstrapState
  readonly viewportPhase: ViewportPhase
  readonly edgeState: ViewportEdgeState
}
