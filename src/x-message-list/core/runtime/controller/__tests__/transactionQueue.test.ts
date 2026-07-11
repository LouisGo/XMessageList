import { describe, expect, it } from 'vitest'
import type { LoadedSegment } from '../../contracts/segment'
import type { MessageListSnapshot } from '../../contracts/snapshot'
import {
  ProjectionTransactionQueue,
  type ProjectionTransactionPolicy,
} from '../transactionQueue'

const maintenance: ProjectionTransactionPolicy = {
  lane: 'maintenance',
  priority: 10,
  coalescible: true,
  queueDuringMotion: true,
}
const passive: ProjectionTransactionPolicy = {
  lane: 'passive',
  priority: 30,
  coalescible: true,
  queueDuringMotion: true,
}
const liveAppend: ProjectionTransactionPolicy = {
  lane: 'live-append',
  priority: 50,
  coalescible: true,
  queueDuringMotion: true,
}
const edge: ProjectionTransactionPolicy = {
  lane: 'edge',
  priority: 70,
  coalescible: false,
  queueDuringMotion: true,
}
const identity: ProjectionTransactionPolicy = {
  lane: 'passive',
  priority: 35,
  coalescible: false,
  queueDuringMotion: true,
}
const destination: ProjectionTransactionPolicy = {
  lane: 'destination',
  priority: 100,
  coalescible: false,
  queueDuringMotion: false,
}

describe('ProjectionTransactionQueue trim barriers', () => {
  it('carries a dropped trim barrier into the successor effects', () => {
    const queue = new ProjectionTransactionQueue<string, never>()
    queue.enqueue(segment(1, {
      type: 'trim-after',
      trimToken: 'trim:1',
    }), maintenance)
    queue.enqueue(segment(2, {
      type: 'patch',
      changedKeys: ['a'],
    }), passive)

    const next = queue.dequeueReady(snapshot())
    expect(next?.segment.modifier.type).toBe('patch')
    expect(next?.segment.effects).toEqual([
      { type: 'trim-after', trimToken: 'trim:1' },
    ])
  })

  it('dedupes trim effects while coalescing multiple successors', () => {
    const queue = new ProjectionTransactionQueue<string, never>()
    queue.enqueue({
      ...segment(1, { type: 'trim-after', trimToken: 'trim:1' }),
      effects: [{ type: 'trim-after', trimToken: 'trim:1' }],
    }, maintenance)
    queue.enqueue({
      ...segment(2, { type: 'patch', changedKeys: ['a'] }),
      effects: [{ type: 'trim-after', trimToken: 'trim:1' }],
    }, passive)

    expect(queue.dequeueReady(snapshot())?.segment.effects).toEqual([
      { type: 'trim-after', trimToken: 'trim:1' },
    ])
  })

  it('carries trim effects into non-coalescible edge and identity successors', () => {
    const edgeQueue = new ProjectionTransactionQueue<string, never>()
    edgeQueue.enqueue(segment(1, {
      type: 'trim-after',
      trimToken: 'trim:1',
    }), maintenance)
    edgeQueue.enqueue(segment(2, {
      type: 'extend-after',
      requestToken: 'after:2',
    }), edge)
    expect(edgeQueue.dequeueReady(snapshot())?.segment.effects).toEqual([
      { type: 'trim-after', trimToken: 'trim:1' },
    ])

    const identityQueue = new ProjectionTransactionQueue<string, never>()
    identityQueue.enqueue(segment(1, {
      type: 'trim-after',
      trimToken: 'trim:1',
    }), maintenance)
    identityQueue.enqueue(segment(2, {
      type: 'identity-remap',
      remaps: [],
    }), identity)
    expect(identityQueue.dequeueReady(snapshot())?.segment.effects).toEqual([
      { type: 'trim-after', trimToken: 'trim:1' },
    ])
  })

  it('allows a full reset to supersede trim without carrying stale effects', () => {
    const queue = new ProjectionTransactionQueue<string, never>()
    queue.enqueue(segment(1, {
      type: 'trim-after',
      trimToken: 'trim:1',
    }), maintenance)
    queue.enqueue(segment(2, {
      type: 'reset-around',
      target: { sessionId: 'source-a', stableId: 'a' },
    }), destination)

    expect(queue.dequeueReady(snapshot())?.segment.effects).toBeUndefined()
  })

  it('does not drop a non-coalescible carrier merely because it has trim effects', () => {
    const queue = new ProjectionTransactionQueue<string, never>()
    queue.enqueue({
      ...segment(1, { type: 'identity-remap', remaps: [] }),
      effects: [{ type: 'trim-after', trimToken: 'trim:1' }],
    }, identity)
    queue.enqueue(segment(2, {
      type: 'patch',
      changedKeys: ['a'],
    }), passive)

    const first = queue.dequeueReady(snapshot())
    expect(first?.segment.modifier.type).toBe('identity-remap')
    expect(first?.segment.effects).toEqual([
      { type: 'trim-after', trimToken: 'trim:1' },
    ])
  })

  it('keeps durable trim queued until a staged reset commits', () => {
    const rollbackQueue = new ProjectionTransactionQueue<string, never>()
    rollbackQueue.enqueue(segment(1, {
      type: 'trim-after',
      trimToken: 'trim:1',
    }), maintenance)
    rollbackQueue.enqueue(
      segment(2, {
        type: 'reset-around',
        target: { sessionId: 'source-a', stableId: 'a' },
      }),
      destination,
      { commit: () => false },
    )

    expect(rollbackQueue.dequeueReady(snapshot())?.stage).toBeDefined()
    expect(rollbackQueue.dequeueReady(snapshot())?.segment.modifier.type)
      .toBe('trim-after')

    const committedQueue = new ProjectionTransactionQueue<string, never>()
    committedQueue.enqueue(segment(1, {
      type: 'trim-after',
      trimToken: 'trim:1',
    }), maintenance)
    committedQueue.enqueue(
      segment(2, {
        type: 'reset-around',
        target: { sessionId: 'source-a', stableId: 'a' },
      }),
      destination,
      { commit: () => true },
    )
    expect(committedQueue.dequeueReady(snapshot())?.stage).toBeDefined()
    expect(committedQueue.dequeueReady({
      ...snapshot(),
      segmentRevision: 2,
    })).toBeUndefined()
  })

  it('does not let a stage discard a carrier trim effect before CAS', () => {
    const queue = new ProjectionTransactionQueue<string, never>()
    queue.enqueue({
      ...segment(1, { type: 'patch', changedKeys: ['a'] }),
      effects: [{ type: 'trim-after', trimToken: 'trim:1' }],
    }, passive)
    queue.enqueue(
      segment(2, {
        type: 'reset-around',
        target: { sessionId: 'source-a', stableId: 'a' },
      }),
      destination,
      { commit: () => false },
    )

    expect(queue.dequeueReady(snapshot())?.stage).toBeDefined()
    expect(queue.dequeueReady(snapshot())?.segment).toMatchObject({
      modifier: { type: 'patch' },
      effects: [{ type: 'trim-after', trimToken: 'trim:1' }],
    })
  })

  it('preserves a queued patch when staged CAS rejects', () => {
    const queue = new ProjectionTransactionQueue<string, never>()
    queue.enqueue(segment(1, {
      type: 'patch',
      changedKeys: ['a'],
    }), passive)
    queue.enqueue(stagedResetSegment(2), destination, { commit: () => false })

    expect(queue.dequeueReady(snapshot())?.stage).toBeDefined()
    expect(queue.dequeueReady(snapshot())?.segment.modifier.type).toBe('patch')
  })

  it('preserves a queued append after a staged projection times out', () => {
    const queue = new ProjectionTransactionQueue<string, never>()
    queue.enqueue(segment(1, {
      type: 'append',
      changedKeys: ['a'],
      follow: 'preserve',
    }), liveAppend)
    queue.enqueue(stagedResetSegment(2), destination, { commit: () => true })

    expect(queue.dequeueReady(snapshot())?.stage).toBeDefined()
    // timeout/rollback 恢复旧 revision；durable append 因此仍可继续执行。
    expect(queue.dequeueReady(snapshot())?.segment.modifier.type).toBe('append')
  })

  it('lets successful staged CAS stale older patch and append entries', () => {
    for (const queued of [
      { segment: segment(1, { type: 'patch', changedKeys: ['a'] }), policy: passive },
      { segment: segment(1, { type: 'append', changedKeys: ['a'], follow: 'preserve' }), policy: liveAppend },
    ]) {
      const queue = new ProjectionTransactionQueue<string, never>()
      queue.enqueue(queued.segment, queued.policy)
      queue.enqueue(stagedResetSegment(2), destination, { commit: () => true })
      expect(queue.dequeueReady(snapshot())?.stage).toBeDefined()
      expect(queue.dequeueReady({ ...snapshot(), segmentRevision: 2 }))
        .toBeUndefined()
    }
  })
})

function segment(
  segmentRevision: number,
  modifier: LoadedSegment<string, never>['modifier'],
): LoadedSegment<string, never> {
  return {
    sessionId: 'source-a',
    generation: 1,
    segmentRevision,
    items: [],
    hasMoreBefore: false,
    hasMoreAfter: true,
    context: 'history',
    modifier,
  }
}

function snapshot(): MessageListSnapshot<string, never> {
  return {
    sessionId: 'source-a',
    generation: 1,
    segmentRevision: 0,
  } as MessageListSnapshot<string, never>
}

function stagedResetSegment(
  segmentRevision: number,
): LoadedSegment<string, never> {
  return segment(segmentRevision, {
    type: 'reset-around',
    target: { sessionId: 'source-a', stableId: 'a' },
  })
}
