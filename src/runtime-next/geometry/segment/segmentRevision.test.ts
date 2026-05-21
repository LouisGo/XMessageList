import { describe, expect, it } from 'vitest'
import type { MessageRuntimeItemKey } from '../../identity/types'
import { PhysicalSegmentRevisionController } from './segmentRevision'
import type { PhysicalSegmentDraft } from './physicalSegment.types'

function committedKey(messageId: string): MessageRuntimeItemKey {
  return {
    kind: 'committed',
    messageId,
  }
}

function createDraft(overrides: Partial<PhysicalSegmentDraft> = {}): PhysicalSegmentDraft {
  return {
    logicalSegmentId: 'logical-segment',
    logicalAnchorKey: committedKey('m-anchor'),
    logicalStartItemKey: committedKey('m-start'),
    logicalEndItemKey: committedKey('m-end'),
    renderWindowStartKey: committedKey('m-start'),
    renderWindowEndKey: committedKey('m-end'),
    logicalRole: 'latest',
    estimatedRowsHeight: 640,
    physicalWindowHeight: 720,
    scrollHeightCap: 800,
    capMode: 'normal',
    ...overrides,
  }
}

describe('physical segment revision controller', () => {
  it('allocates revision before publish and preserves the pending token until ack', () => {
    const controller = new PhysicalSegmentRevisionController({
      feedId: 'feed',
      generation: 1,
      now: () => 42,
    })

    const pending = controller.startPublication({
      projectionRevision: 8,
      transactionId: 'tx-1',
      reason: 'bootstrap',
      segment: createDraft(),
    })

    expect(pending.segment.segmentRevision).toBe(1)
    expect(pending.commitToken).toEqual({
      feedId: 'feed',
      generation: 1,
      projectionRevision: 8,
      segmentId: 'feed:g1:physical-segment-1',
      segmentRevision: 1,
      transactionId: 'tx-1',
    })
    expect(controller.getPendingSegment()).toEqual(pending.segment)
    expect(controller.getCommittedSegment()).toBeNull()
    expect(controller.snapshot()).toEqual(
      expect.objectContaining({
        status: 'pending',
        nextSegmentRevision: 2,
        nextSegmentSequence: 2,
      }),
    )
  })

  it('commits only on exact token match and rejects mismatches without mutating the committed segment', () => {
    const controller = new PhysicalSegmentRevisionController({
      feedId: 'feed',
      generation: 1,
    })

    const pending = controller.startPublication({
      projectionRevision: 9,
      transactionId: 'tx-2',
      reason: 'segmentRelayout',
      relayoutReason: 'measurement',
      segment: createDraft({
        logicalSegmentId: 'logical-segment-2',
        logicalRole: 'target',
      }),
    })

    expect(
      controller.acknowledgeCommit({
        ...pending.commitToken,
        segmentRevision: pending.commitToken.segmentRevision + 1,
      }),
    ).toEqual({
      committed: false,
      reason: 'commit-token-mismatch',
    })
    expect(controller.getCommittedSegment()).toBeNull()
    expect(controller.getPendingSegment()).toEqual(pending.segment)

    expect(controller.acknowledgeCommit(pending.commitToken)).toEqual({
      committed: true,
      segment: pending.segment,
      commitToken: pending.commitToken,
    })
    expect(controller.getCommittedSegment()).toEqual(pending.segment)
    expect(controller.getPendingSegment()).toBeNull()
    expect(controller.snapshot()).toEqual(
      expect.objectContaining({
        status: 'idle',
        lastCommitToken: pending.commitToken,
        nextSegmentRevision: 2,
      }),
    )
  })

  it('validates a pending commit token without committing the segment', () => {
    const controller = new PhysicalSegmentRevisionController({
      feedId: 'feed',
      generation: 1,
    })

    const pending = controller.startPublication({
      projectionRevision: 10,
      transactionId: 'tx-validate',
      reason: 'bootstrap',
      segment: createDraft(),
    })

    expect(controller.validatePendingCommitToken(pending.commitToken)).toEqual({
      valid: true,
      segment: pending.segment,
      commitToken: pending.commitToken,
    })
    expect(controller.getCommittedSegment()).toBeNull()
    expect(controller.getPendingSegment()).toEqual(pending.segment)
  })

  it('does not reuse an aborted revision and keeps the previous stable segment intact', () => {
    const controller = new PhysicalSegmentRevisionController({
      feedId: 'feed',
      generation: 1,
    })

    const first = controller.startPublication({
      projectionRevision: 10,
      transactionId: 'tx-3',
      reason: 'bootstrap',
      segment: createDraft({
        logicalSegmentId: 'stable-segment',
        segmentId: 'stable-segment',
      }),
    })
    controller.acknowledgeCommit(first.commitToken)

    controller.startPublication({
      projectionRevision: 11,
      transactionId: 'tx-4',
      reason: 'segmentRelayout',
      segment: createDraft({
        logicalSegmentId: 'stable-segment',
        segmentId: 'stable-segment',
      }),
    })
    const aborted = controller.abortPendingPublication()

    expect(aborted?.segment.segmentRevision).toBe(2)
    expect(controller.getCommittedSegment()).toEqual(first.segment)
    expect(controller.getPendingSegment()).toBeNull()

    const third = controller.startPublication({
      projectionRevision: 12,
      transactionId: 'tx-5',
      reason: 'segmentRelayout',
      segment: createDraft({
        logicalSegmentId: 'stable-segment',
        segmentId: 'stable-segment',
      }),
    })

    expect(third.segment.segmentRevision).toBe(3)
    expect(third.segment.segmentId).toBe('stable-segment')
    expect(controller.getCommittedSegment()).toEqual(first.segment)
  })

  it('rejects a second publication while one revision is pending', () => {
    const controller = new PhysicalSegmentRevisionController({
      feedId: 'feed',
      generation: 1,
    })

    controller.startPublication({
      projectionRevision: 13,
      transactionId: 'tx-6',
      reason: 'bootstrap',
      segment: createDraft(),
    })

    expect(() =>
      controller.startPublication({
        projectionRevision: 14,
        transactionId: 'tx-7',
        reason: 'segmentRelayout',
        segment: createDraft(),
      }),
    ).toThrow(/already pending commit ack/)
  })
})
