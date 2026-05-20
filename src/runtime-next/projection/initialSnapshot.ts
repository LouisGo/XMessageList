import type {
  MessageViewportSnapshot,
  ProjectionCommitToken,
} from './types'

export function createInitialProjectionSnapshot<
  TMessage,
  TOptimistic = unknown,
>(input: {
  readonly feedId: string
  readonly generation: number
}): MessageViewportSnapshot<TMessage, TOptimistic> {
  const commitToken: ProjectionCommitToken = {
    feedId: input.feedId,
    generation: input.generation,
    projectionRevision: 0,
    segmentId: 'p2-contract-placeholder',
    segmentRevision: 0,
    transactionId: 'p2-contract-placeholder',
  }

  // P2 只提供空 projection 合同；rows/spacers 后续只能由 geometry transaction 发布。
  return {
    feedId: input.feedId,
    generation: input.generation,
    revision: 0,
    commitToken,
    items: [],
    renderWindow: {
      startIndex: 0,
      endIndex: 0,
      itemKeys: [],
    },
    topSpacer: 0,
    bottomSpacer: 0,
    bottomLockState: 'UNLOCKED',
    bootstrapState: 'INITIAL',
    viewportPhase: 'IDLE',
    edgeState: {
      before: 'idle',
      after: 'idle',
    },
  }
}
