import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { PendingTransaction } from './controllerTransactionHelpers'

export class ProjectionTransactionQueue<TMessage, TOptimistic> {
  private pending: PendingTransaction<TMessage, TOptimistic> | null = null

  private readonly queue: Array<LoadedSegment<TMessage, TOptimistic>> = []

  private advancing = false

  getPending(): PendingTransaction<TMessage, TOptimistic> | null {
    return this.pending
  }

  setPending(pending: PendingTransaction<TMessage, TOptimistic>): void {
    this.pending = pending
  }

  clearPending(): void {
    this.pending = null
  }

  clearPendingToken(
    token: ProjectionCommitToken,
  ): PendingTransaction<TMessage, TOptimistic> | null {
    if (!this.pending || !isSameProjectionToken(this.pending.token, token)) {
      return null
    }

    const pending = this.pending
    this.pending = null
    return pending
  }

  cancelPendingBeforeGeneration(
    generation: number,
  ): PendingTransaction<TMessage, TOptimistic> | null {
    if (!this.pending || this.pending.segment.generation >= generation) {
      return null
    }

    const pending = this.pending
    this.pending = null
    return pending
  }

  enqueue(segment: LoadedSegment<TMessage, TOptimistic>): number {
    this.queue.push(segment)
    return this.queue.length
  }

  dequeueReady(): LoadedSegment<TMessage, TOptimistic> | undefined {
    if (this.pending || this.advancing) {
      return undefined
    }

    return this.queue.shift()
  }

  hasPending(): boolean {
    return this.pending !== null
  }

  shouldQueue(): boolean {
    return this.pending !== null || this.advancing
  }

  beginAdvancing(): void {
    this.advancing = true
  }

  endAdvancing(): void {
    this.advancing = false
  }

  clear(): void {
    this.pending = null
    this.queue.length = 0
    this.advancing = false
  }

  removeQueuedBeforeGeneration(generation: number): void {
    removeQueuedSegmentsBeforeGeneration(this.queue, generation)
  }

  isStaleSegment(
    segment: LoadedSegment<TMessage, TOptimistic>,
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): boolean {
    return isStaleLoadedSegment(
      segment,
      this.queue.at(-1) ?? this.pending?.segment,
      snapshot,
    )
  }
}

export function removeQueuedSegmentsBeforeGeneration<TMessage, TOptimistic>(
  queue: Array<LoadedSegment<TMessage, TOptimistic>>,
  generation: number,
): void {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index].generation < generation) {
      queue.splice(index, 1)
    }
  }
}

export function isStaleLoadedSegment<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  latestSegment: LoadedSegment<TMessage, TOptimistic> | undefined,
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
): boolean {
  const latestGeneration = latestSegment?.generation ?? snapshot.generation
  const latestSegmentRevision = latestSegment?.segmentRevision ??
    snapshot.segmentRevision

  return segment.generation < latestGeneration ||
    (
      segment.generation === latestGeneration &&
      segment.segmentRevision <= latestSegmentRevision
    )
}

function isSameProjectionToken(
  left: ProjectionCommitToken,
  right: ProjectionCommitToken,
): boolean {
  return left.feedId === right.feedId &&
    left.generation === right.generation &&
    left.segmentRevision === right.segmentRevision &&
    left.projectionRevision === right.projectionRevision
}
