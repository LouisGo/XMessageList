import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { PendingTransaction } from './controllerTransactionHelpers'

export type ProjectionTransactionLane =
  | 'destination'
  | 'latest-follow'
  | 'edge'
  | 'live-append'
  | 'passive'
  | 'maintenance'

export type ProjectionTransactionPolicy = {
  lane: ProjectionTransactionLane
  priority: number
  coalescible: boolean
  queueDuringMotion: boolean
}

export type ProjectionTransactionQueueEntry<TMessage, TOptimistic> = {
  segment: LoadedSegment<TMessage, TOptimistic>
  policy: ProjectionTransactionPolicy
}

export type ProjectionTransactionEnqueueResult = {
  queueLength: number
  dropped: number
}

export class ProjectionTransactionQueue<TMessage, TOptimistic> {
  private pending: PendingTransaction<TMessage, TOptimistic> | null = null

  private readonly queue: Array<ProjectionTransactionQueueEntry<TMessage, TOptimistic>> = []

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

  enqueue(
    segment: LoadedSegment<TMessage, TOptimistic>,
    policy: ProjectionTransactionPolicy,
  ): ProjectionTransactionEnqueueResult {
    const dropped = this.dropSupersededQueuedSegments(segment, policy)
    const entry = { segment, policy }
    const index = this.queue.findIndex((queued) =>
      queued.policy.priority < policy.priority
    )

    if (index >= 0) {
      this.queue.splice(index, 0, entry)
    } else {
      this.queue.push(entry)
    }

    return { queueLength: this.queue.length, dropped }
  }

  dequeueReady(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): ProjectionTransactionQueueEntry<TMessage, TOptimistic> | undefined {
    if (this.pending || this.advancing) {
      return undefined
    }

    while (this.queue.length > 0) {
      const next = this.queue.shift()
      if (!next || isStaleLoadedSegment(next.segment, undefined, snapshot)) {
        continue
      }

      return next
    }

    return undefined
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
      this.getLatestQueuedOrPendingSegment(),
      snapshot,
    )
  }

  private getLatestQueuedOrPendingSegment(): LoadedSegment<TMessage, TOptimistic> | undefined {
    let latest = this.pending?.segment

    for (const queued of this.queue) {
      if (!latest || isNewerSegment(queued.segment, latest)) {
        latest = queued.segment
      }
    }

    return latest
  }

  private dropSupersededQueuedSegments(
    segment: LoadedSegment<TMessage, TOptimistic>,
    policy: ProjectionTransactionPolicy,
  ): number {
    let dropped = 0

    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index]
      if (!queued || !shouldDropQueuedSegment(queued, segment, policy)) {
        continue
      }
      this.queue.splice(index, 1)
      dropped += 1
    }

    return dropped
  }
}

export function removeQueuedSegmentsBeforeGeneration<TMessage, TOptimistic>(
  queue: Array<ProjectionTransactionQueueEntry<TMessage, TOptimistic>>,
  generation: number,
): void {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index].segment.generation < generation) {
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
  return left.sessionId === right.sessionId &&
    left.generation === right.generation &&
    left.segmentRevision === right.segmentRevision &&
    left.projectionRevision === right.projectionRevision
}

function isNewerSegment<TMessage, TOptimistic>(
  left: LoadedSegment<TMessage, TOptimistic>,
  right: LoadedSegment<TMessage, TOptimistic>,
): boolean {
  return left.generation > right.generation ||
    (
      left.generation === right.generation &&
      left.segmentRevision > right.segmentRevision
    )
}

function shouldDropQueuedSegment<TMessage, TOptimistic>(
  queued: ProjectionTransactionQueueEntry<TMessage, TOptimistic>,
  incoming: LoadedSegment<TMessage, TOptimistic>,
  policy: ProjectionTransactionPolicy,
): boolean {
  if (
    queued.segment.sessionId !== incoming.sessionId ||
    queued.segment.generation !== incoming.generation ||
    queued.segment.segmentRevision >= incoming.segmentRevision
  ) {
    return false
  }

  if (policy.priority > queued.policy.priority && queued.policy.coalescible) {
    return true
  }

  return policy.coalescible &&
    queued.policy.coalescible &&
    policy.priority >= queued.policy.priority
}
