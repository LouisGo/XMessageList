import type {
  LoadedSegment,
  SegmentProjectionEffect,
} from '../contracts/segment'
import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { PendingTransaction, ProjectionStage } from './controllerTransactionHelpers'

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
  stage?: ProjectionStage
}

export type ProjectionTransactionEnqueueResult = {
  queueLength: number
  dropped: number
}

// projection 事务队列按 lane/priority 串行提交；可合并事务会丢弃被更新 revision 覆盖的旧项。
export class ProjectionTransactionQueue<TMessage, TOptimistic> {
  private pending: PendingTransaction<TMessage, TOptimistic> | null = null

  private readonly queue: Array<ProjectionTransactionQueueEntry<TMessage, TOptimistic>> = []

  private advancing = false

  getPending(): PendingTransaction<TMessage, TOptimistic> | null {
    return this.pending
  }

  recordScrollWrite(): void {
    if (this.pending) this.pending.scrollWriteCount += 1
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
    stage?: ProjectionStage,
  ): ProjectionTransactionEnqueueResult {
    const merged = this.dropSupersededQueuedSegments(segment, policy, stage)
    const entry = { segment: merged.segment, policy, stage }
    const index = this.queue.findIndex((queued) =>
      queued.policy.priority < policy.priority
    )

    if (index >= 0) {
      this.queue.splice(index, 0, entry)
    } else {
      this.queue.push(entry)
    }

    return { queueLength: this.queue.length, dropped: merged.dropped }
  }

  dequeueReady(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): ProjectionTransactionQueueEntry<TMessage, TOptimistic> | undefined {
    if (this.pending || this.advancing) {
      return undefined
    }

    while (this.queue.length > 0) {
      const next = this.queue.shift()
      // 出队时再次判 stale，覆盖 pending/motion 期间到达的更新。
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

  isBusy(): boolean {
    return this.pending !== null || this.advancing
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

  removeQueuedStage(
    segment: Pick<LoadedSegment<TMessage, TOptimistic>, 'sessionId' | 'generation' | 'segmentRevision'>,
  ): boolean {
    const index = this.queue.findIndex((entry) =>
      Boolean(entry.stage) &&
      entry.segment.sessionId === segment.sessionId &&
      entry.segment.generation === segment.generation &&
      entry.segment.segmentRevision === segment.segmentRevision
    )
    if (index < 0) return false
    this.queue.splice(index, 1)
    return true
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
    stage?: ProjectionStage,
  ): {
    dropped: number
    segment: LoadedSegment<TMessage, TOptimistic>
  } {
    // stage 在 CAS/commit 前没有任何 authoritative 权限：只按 priority 入队，
    // 不得 drop、merge 或转移现有 durable entry 的 modifier/effects。
    if (stage) return { dropped: 0, segment }
    let dropped = 0
    let mergedSegment = segment

    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index]
      if (!queued) continue
      const supersedesPrimaryTrim =
        doesIncomingSupersedeQueuedPrimaryTrim(queued.segment, mergedSegment)
      if (
        !supersedesPrimaryTrim &&
        !shouldDropQueuedSegment(queued, mergedSegment, policy)
      ) {
        continue
      }

      // 后续 projection 可以覆盖旧数据，但不能吞掉 trim 所携带的 edge-latch 与
      // metric 失效语义。除完整 reset 外，先把 trim 原子转移到 successor effects 再 drop。
      if (!canSafelySupersedeTrimEffects(mergedSegment)) {
        mergedSegment = mergeTrimEffects(mergedSegment, queued.segment)
      }
      this.queue.splice(index, 1)
      dropped += 1
    }

    return { dropped, segment: mergedSegment }
  }
}

function isPrimaryTrim<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
): boolean {
  return segment.modifier.type === 'trim-before' ||
    segment.modifier.type === 'trim-after'
}

function doesIncomingSupersedeQueuedPrimaryTrim<TMessage, TOptimistic>(
  queued: LoadedSegment<TMessage, TOptimistic>,
  incoming: LoadedSegment<TMessage, TOptimistic>,
): boolean {
  if (
    queued.sessionId !== incoming.sessionId ||
    queued.generation !== incoming.generation ||
    queued.segmentRevision >= incoming.segmentRevision
  ) {
    return false
  }
  // 只有主 modifier 是 durable trim 时才允许越过普通 coalescing policy。
  // carrier.effects 不能反向赋予 identity/extend 等主事务“可删除”语义。
  return isPrimaryTrim(queued)
}

function canSafelySupersedeTrimEffects<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
): boolean {
  return segment.modifier.type === 'bootstrap' ||
    segment.modifier.type === 'reset-around' ||
    segment.modifier.type === 'reset-latest'
}

function mergeTrimEffects<TMessage, TOptimistic>(
  incoming: LoadedSegment<TMessage, TOptimistic>,
  queued: LoadedSegment<TMessage, TOptimistic>,
): LoadedSegment<TMessage, TOptimistic> {
  const effects: SegmentProjectionEffect[] = [...(incoming.effects ?? [])]
  const candidates: SegmentProjectionEffect[] = [...(queued.effects ?? [])]
  if (
    queued.modifier.type === 'trim-before' ||
    queued.modifier.type === 'trim-after'
  ) {
    candidates.push(queued.modifier)
  }

  for (const candidate of candidates) {
    if (effects.some((effect) =>
      effect.type === candidate.type && effect.trimToken === candidate.trimToken
    )) {
      continue
    }
    effects.push(candidate)
  }

  return effects.length === (incoming.effects?.length ?? 0)
    ? incoming
    : { ...incoming, effects }
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
