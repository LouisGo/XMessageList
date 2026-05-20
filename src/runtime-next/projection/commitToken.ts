import type { ProjectionCommitToken } from './types'

export function isProjectionCommitTokenEqual(
  left: ProjectionCommitToken,
  right: ProjectionCommitToken,
): boolean {
  return (
    left.feedId === right.feedId &&
    left.generation === right.generation &&
    left.projectionRevision === right.projectionRevision &&
    left.segmentId === right.segmentId &&
    left.segmentRevision === right.segmentRevision &&
    left.transactionId === right.transactionId
  )
}

