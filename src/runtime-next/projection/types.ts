import type {
  RuntimeNextFeedId,
  RuntimeNextGeneration,
  RuntimeNextRevision,
  RuntimeNextSegmentId,
  RuntimeNextTransactionId,
} from '../types'

export type ProjectionCommitToken = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
  readonly projectionRevision: RuntimeNextRevision
  readonly segmentId: RuntimeNextSegmentId
  readonly segmentRevision: RuntimeNextRevision
  readonly transactionId: RuntimeNextTransactionId
}

export type ProjectionRow<TPayload = unknown> = {
  readonly key: string
  readonly payload: TPayload
}

export type ProjectionEdgeState = {
  readonly before: 'idle' | 'loading' | 'exhausted'
  readonly after: 'idle' | 'loading' | 'exhausted'
}

export type MessageViewportSnapshot<TPayload = unknown> = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
  readonly projectionRevision: RuntimeNextRevision
  readonly commitToken: ProjectionCommitToken
  readonly rows: readonly ProjectionRow<TPayload>[]
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly edgeState: ProjectionEdgeState
  readonly followBottomVisible: boolean
}

