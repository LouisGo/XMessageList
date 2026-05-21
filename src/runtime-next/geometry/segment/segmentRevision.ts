import type {
  RuntimeNextFeedId,
  RuntimeNextGeneration,
  RuntimeNextRevision,
  RuntimeNextTransactionId,
} from '../../identity/types'
import type { ProjectionCommitToken } from '../../projection/types'
import { isProjectionCommitTokenEqual } from '../../projection/commitToken'
import { createPhysicalSegmentId } from '../config/config'
import type {
  PendingPhysicalSegmentRevision,
  PhysicalSegment,
  PhysicalSegmentDraft,
  PhysicalSegmentRevisionReason,
  PhysicalSegmentRevisionSnapshot,
} from './physicalSegment.types'
import type { SegmentRelayoutReason } from '../types'

export type PhysicalSegmentRevisionControllerOptions = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
  readonly initialSegmentRevision?: RuntimeNextRevision
  readonly initialSegmentSequence?: number
  readonly initialCommittedSegment?: PhysicalSegment | null
  readonly now?: () => number
}

export type StartPhysicalSegmentRevisionInput = {
  readonly projectionRevision: RuntimeNextRevision
  readonly transactionId: RuntimeNextTransactionId
  readonly reason: PhysicalSegmentRevisionReason
  readonly segment: PhysicalSegmentDraft
  readonly relayoutReason?: SegmentRelayoutReason
}

export type PhysicalSegmentCommitAckResult =
  | {
      readonly committed: true
      readonly segment: PhysicalSegment
      readonly commitToken: ProjectionCommitToken
    }
  | {
      readonly committed: false
      readonly reason: 'no-pending-segment' | 'commit-token-mismatch'
    }

export type PhysicalSegmentCommitValidationResult =
  | {
      readonly valid: true
      readonly segment: PhysicalSegment
      readonly commitToken: ProjectionCommitToken
    }
  | {
      readonly valid: false
      readonly reason: 'no-pending-segment' | 'commit-token-mismatch'
    }

export class PhysicalSegmentRevisionController {
  readonly #feedId: RuntimeNextFeedId
  readonly #generation: RuntimeNextGeneration
  readonly #now: () => number

  #committedSegment: PhysicalSegment | null
  #pending: PendingPhysicalSegmentRevision | null = null
  #lastCommitToken: ProjectionCommitToken | null = null
  #nextSegmentRevision: RuntimeNextRevision
  #nextSegmentSequence: number

  constructor(options: PhysicalSegmentRevisionControllerOptions) {
    this.#feedId = options.feedId
    this.#generation = options.generation
    this.#now = options.now ?? Date.now
    this.#committedSegment = options.initialCommittedSegment ?? null
    const stableRevision =
      options.initialSegmentRevision ??
      options.initialCommittedSegment?.segmentRevision ??
      0
    this.#nextSegmentRevision =
      stableRevision + 1
    this.#nextSegmentSequence = options.initialSegmentSequence ?? 1
  }

  startPublication(
    input: StartPhysicalSegmentRevisionInput,
  ): PendingPhysicalSegmentRevision {
    if (this.#pending !== null) {
      throw new Error(
        'physical segment revision is already pending commit ack',
      )
    }

    const segmentId = input.segment.segmentId ?? this.#allocateSegmentId()
    const segmentRevision = this.#allocateSegmentRevision()
    const segment: PhysicalSegment = {
      ...input.segment,
      segmentId,
      segmentRevision,
    }
    const commitToken: ProjectionCommitToken = {
      feedId: this.#feedId,
      generation: this.#generation,
      projectionRevision: input.projectionRevision,
      segmentId,
      segmentRevision,
      transactionId: input.transactionId,
    }

    // segmentRevision 必须在 projection 发布前分配；ack/measure 阶段只能引用这个 token。
    this.#pending = {
      status: 'pending',
      reason: input.reason,
      segment,
      previousSegment: this.#committedSegment,
      commitToken,
      transactionId: input.transactionId,
      allocatedAt: this.#now(),
      relayoutReason: input.relayoutReason,
    }

    return this.#pending
  }

  acknowledgeCommit(
    commitToken: ProjectionCommitToken,
  ): PhysicalSegmentCommitAckResult {
    const validation = this.validatePendingCommitToken(commitToken)
    if ('reason' in validation) {
      return {
        committed: false,
        reason: validation.reason,
      }
    }

    const committed = this.#pending!
    this.#committedSegment = committed.segment
    this.#lastCommitToken = committed.commitToken
    this.#pending = null

    return {
      committed: true,
      segment: committed.segment,
      commitToken: committed.commitToken,
    }
  }

  validatePendingCommitToken(
    commitToken: ProjectionCommitToken,
  ): PhysicalSegmentCommitValidationResult {
    if (this.#pending === null) {
      return {
        valid: false,
        reason: 'no-pending-segment',
      }
    }

    if (!isProjectionCommitTokenEqual(this.#pending.commitToken, commitToken)) {
      return {
        valid: false,
        reason: 'commit-token-mismatch',
      }
    }

    return {
      valid: true,
      segment: this.#pending.segment,
      commitToken: this.#pending.commitToken,
    }
  }

  replacePendingCommitToken(input: {
    readonly expected: ProjectionCommitToken
    readonly next: ProjectionCommitToken
  }): boolean {
    if (this.#pending === null) {
      return false
    }
    if (!isProjectionCommitTokenEqual(this.#pending.commitToken, input.expected)) {
      return false
    }
    if (
      input.next.feedId !== this.#feedId ||
      input.next.generation !== this.#generation ||
      input.next.segmentId !== this.#pending.segment.segmentId ||
      input.next.segmentRevision !== this.#pending.segment.segmentRevision ||
      input.next.transactionId !== this.#pending.transactionId
    ) {
      return false
    }

    // 同一个 segmentRevision 的 correction projection 只能替换 commit token；
    // 不能重新分配 revision，否则 scrollbar 会在一次几何 mutation 里看到两个版本。
    this.#pending = {
      ...this.#pending,
      commitToken: input.next,
    }

    return true
  }

  abortPendingPublication(): PendingPhysicalSegmentRevision | null {
    const aborted = this.#pending
    this.#pending = null

    return aborted
  }

  getCommittedSegment(): PhysicalSegment | null {
    return this.#committedSegment
  }

  getPendingSegment(): PhysicalSegment | null {
    return this.#pending?.segment ?? null
  }

  getPendingRevision(): PendingPhysicalSegmentRevision | null {
    return this.#pending
  }

  snapshot(): PhysicalSegmentRevisionSnapshot {
    return {
      status: this.#pending === null ? 'idle' : 'pending',
      committedSegment: this.#committedSegment,
      pendingSegment: this.#pending?.segment ?? null,
      lastCommitToken: this.#lastCommitToken,
      nextSegmentRevision: this.#nextSegmentRevision,
      nextSegmentSequence: this.#nextSegmentSequence,
    }
  }

  #allocateSegmentId(): string {
    const sequence = this.#nextSegmentSequence
    this.#nextSegmentSequence += 1

    return createPhysicalSegmentId({
      feedId: this.#feedId,
      generation: this.#generation,
      sequence,
    })
  }

  #allocateSegmentRevision(): RuntimeNextRevision {
    const revision = this.#nextSegmentRevision
    this.#nextSegmentRevision += 1

    return revision
  }
}
