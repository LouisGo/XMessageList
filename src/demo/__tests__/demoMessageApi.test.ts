import { describe, expect, it, vi } from 'vitest'
import { createDemoMessages } from '../demoData'
import type { PersistedDemoFeed } from '../demoLocalStoreClient'
import {
  getDemoRespAnchor,
  getLatestMessages,
  getMessagesAround,
  messagesAroundRespToSnapshot,
  toCommittedItem,
} from '../demoMessageApi'

// Mock loadPersistedDemoFeed so tests don't depend on network/localStorage
vi.mock('../demoLocalStoreClient', () => ({
  loadPersistedDemoFeed: vi.fn(),
  savePersistedDemoFeed: vi.fn(),
  writeDemoLog: vi.fn(),
  createDemoRequestId: vi.fn(() => 'test-request-id'),
}))

import { loadPersistedDemoFeed } from '../demoLocalStoreClient'

const mockLoadFeed = vi.mocked(loadPersistedDemoFeed)

function makeFeed(feedId: string, count: number): PersistedDemoFeed {
  const messages = createDemoMessages(count, feedId)
  return {
    version: 1,
    feedId,
    revision: 1,
    hasMoreBefore: true,
    messages,
    updatedAt: new Date().toISOString(),
  }
}

describe('getLatestMessages', () => {
  it('returns feed-not-found when feed does not exist', async () => {
    mockLoadFeed.mockResolvedValueOnce(null)

    const resp = await getLatestMessages({ feedId: 'feed-missing' })

    expect(resp.ok).toBe(false)
    if (!resp.ok) {
      expect(resp.errorCode).toBe('feed-not-found')
    }
  })

  it('returns empty ok response for empty feed', async () => {
    mockLoadFeed.mockResolvedValueOnce({
      version: 1,
      feedId: 'feed-empty',
      revision: 1,
      messages: [],
      updatedAt: new Date().toISOString(),
    })

    const resp = await getLatestMessages({ feedId: 'feed-empty' })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.messages).toEqual([])
      expect(resp.total).toBe(0)
      expect(resp.hasMoreBefore).toBe(false)
      expect(resp.hasMoreAfter).toBe(false)
    }
  })

  it('returns all messages when total <= limit', async () => {
    const feed = makeFeed('feed-small', 5)
    mockLoadFeed.mockResolvedValueOnce(feed)

    const resp = await getLatestMessages({ feedId: 'feed-small', limit: 10 })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.messages).toHaveLength(5)
      expect(resp.total).toBe(5)
      expect(resp.hasMoreBefore).toBe(false)
      expect(resp.anchor.messageId).toBe(feed.messages[4].id)
    }
  })

  it('returns last N messages when total > limit', async () => {
    const feed = makeFeed('feed-large', 80)
    mockLoadFeed.mockResolvedValueOnce(feed)

    const resp = await getLatestMessages({ feedId: 'feed-large', limit: 40 })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.messages).toHaveLength(40)
      expect(resp.total).toBe(80)
      expect(resp.hasMoreBefore).toBe(true)
      expect(resp.messages[0].id).toBe(feed.messages[40].id)
      expect(resp.anchor.messageId).toBe(feed.messages[79].id)
    }
  })

  it('uses default limit of 40 when not specified', async () => {
    const feed = makeFeed('feed-default', 50)
    mockLoadFeed.mockResolvedValueOnce(feed)

    const resp = await getLatestMessages({ feedId: 'feed-default' })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.messages).toHaveLength(40)
      expect(resp.hasMoreBefore).toBe(true)
    }
  })
})

describe('getMessagesAround', () => {
  it('returns feed-not-found when feed does not exist', async () => {
    mockLoadFeed.mockResolvedValueOnce(null)

    const resp = await getMessagesAround({
      feedId: 'feed-missing',
      anchor: { messageId: 'some-id' },
      before: 10,
      after: 10,
    })

    expect(resp.ok).toBe(false)
    if (!resp.ok) {
      expect(resp.errorCode).toBe('feed-not-found')
    }
  })

  it('returns empty-feed error for empty feed', async () => {
    mockLoadFeed.mockResolvedValueOnce({
      version: 1,
      feedId: 'feed-empty',
      revision: 1,
      messages: [],
      updatedAt: new Date().toISOString(),
    })

    const resp = await getMessagesAround({
      feedId: 'feed-empty',
      anchor: { messageId: 'some-id' },
      before: 10,
      after: 10,
    })

    expect(resp.ok).toBe(false)
    if (!resp.ok) {
      expect(resp.errorCode).toBe('empty-feed')
    }
  })

  it('returns anchor-not-found when anchor does not exist', async () => {
    const feed = makeFeed('feed-test', 10)
    mockLoadFeed.mockResolvedValueOnce(feed)

    const resp = await getMessagesAround({
      feedId: 'feed-test',
      anchor: { messageId: 'nonexistent-id' },
      before: 5,
      after: 5,
    })

    expect(resp.ok).toBe(false)
    if (!resp.ok) {
      expect(resp.errorCode).toBe('anchor-not-found')
    }
  })

  it('returns window around anchor with correct hasMore flags', async () => {
    const feed = makeFeed('feed-center', 20)
    mockLoadFeed.mockResolvedValueOnce(feed)

    // anchor at index 10 (sequence 11)
    const anchorMsg = feed.messages[10]
    const resp = await getMessagesAround({
      feedId: 'feed-center',
      anchor: { messageId: anchorMsg.id },
      before: 3,
      after: 3,
    })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.messages).toHaveLength(7) // 3 before + 1 anchor + 3 after
      expect(resp.messages[3].id).toBe(anchorMsg.id)
      expect(resp.hasMoreBefore).toBe(true) // index 10 - 3 = 7 > 0
      expect(resp.hasMoreAfter).toBe(true) // index 10 + 3 = 13 < 19
      expect(resp.total).toBe(20)
    }
  })

  it('clamps window at start when anchor is near beginning', async () => {
    const feed = makeFeed('feed-start', 20)
    mockLoadFeed.mockResolvedValueOnce(feed)

    // anchor at index 1 (only 1 message before it, clamped from before=10)
    const anchorMsg = feed.messages[1]
    const resp = await getMessagesAround({
      feedId: 'feed-start',
      anchor: { messageId: anchorMsg.id },
      before: 10,
      after: 2,
    })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.messages).toHaveLength(4) // 1 before (clamped) + 1 anchor + 2 after
      expect(resp.messages[1].id).toBe(anchorMsg.id)
      expect(resp.hasMoreBefore).toBe(false) // startIndex = 0
      expect(resp.hasMoreAfter).toBe(true)
    }
  })

  it('clamps window at end when anchor is near end', async () => {
    const feed = makeFeed('feed-end', 20)
    mockLoadFeed.mockResolvedValueOnce(feed)

    // anchor at last index (19)
    const anchorMsg = feed.messages[19]
    const resp = await getMessagesAround({
      feedId: 'feed-end',
      anchor: { messageId: anchorMsg.id },
      before: 3,
      after: 10,
    })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.messages).toHaveLength(4) // 3 before + 1 anchor
      expect(resp.hasMoreBefore).toBe(true)
      expect(resp.hasMoreAfter).toBe(false) // endIndex = 19 = total - 1
    }
  })

  it('returns anchor with position from message sequence', async () => {
    const feed = makeFeed('feed-anchor', 5)
    mockLoadFeed.mockResolvedValueOnce(feed)

    const anchorMsg = feed.messages[2]
    const resp = await getMessagesAround({
      feedId: 'feed-anchor',
      anchor: { messageId: anchorMsg.id },
      before: 1,
      after: 1,
    })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.anchor.messageId).toBe(anchorMsg.id)
      expect(resp.anchor.position).toBe(anchorMsg.sequence)
    }
  })
})

describe('messagesAroundRespToSnapshot', () => {
  it('converts ok response to MessageDataSnapshot', () => {
    const feed = makeFeed('feed-snap', 3)
    const resp = {
      ok: true as const,
      anchor: { messageId: feed.messages[2].id, position: 3 },
      anchorStatus: 'normal' as const,
      feedId: 'feed-snap',
      hasMoreAfter: false,
      hasMoreBefore: true,
      total: 10,
      messages: feed.messages,
    }

    const snapshot = messagesAroundRespToSnapshot(resp, {
      generation: 5,
      revision: 3,
      toCommittedItem,
      effect: 'reset',
      snapshotKind: 'initial',
    })

    expect(snapshot.feedId).toBe('feed-snap')
    expect(snapshot.generation).toBe(5)
    expect(snapshot.revision).toBe(3)
    expect(snapshot.items).toHaveLength(3)
    expect(snapshot.items[0].kind).toBe('committed')
    expect(snapshot.anchor?.messageId).toBe(feed.messages[2].id)
    expect(snapshot.anchorStatus).toBe('normal')
    expect(snapshot.hasMoreBefore).toBe(true)
    expect(snapshot.hasMoreAfter).toBe(false)
    expect(snapshot.change.kind).toBe('initial')
    expect(snapshot.change.viewportEffect).toBe('reset')
  })

  it('sets anchor to undefined when anchor messageId is empty', () => {
    const resp = {
      ok: true as const,
      anchor: { messageId: '' },
      anchorStatus: 'normal' as const,
      feedId: 'feed-empty-anchor',
      hasMoreAfter: false,
      hasMoreBefore: false,
      total: 0,
      messages: [],
    }

    const snapshot = messagesAroundRespToSnapshot(resp, {
      generation: 1,
      revision: 1,
      toCommittedItem,
      effect: 'reset',
      snapshotKind: 'initial',
    })

    expect(snapshot.anchor).toBeUndefined()
    expect(snapshot.items).toEqual([])
  })
})

describe('getDemoRespAnchor', () => {
  it('returns anchor from last message in response', () => {
    const feed = makeFeed('feed-anchor', 3)
    const resp = {
      ok: true as const,
      anchor: { messageId: 'original-anchor', position: 99 },
      anchorStatus: 'normal' as const,
      feedId: 'feed-anchor',
      hasMoreAfter: false,
      hasMoreBefore: false,
      total: 3,
      messages: feed.messages,
    }

    const anchor = getDemoRespAnchor(resp)
    const lastMsg = feed.messages[2]
    expect(anchor.messageId).toBe(lastMsg.id)
    expect(anchor.position).toBe(lastMsg.sequence)
  })

  it('falls back to response anchor when messages are empty', () => {
    const resp = {
      ok: true as const,
      anchor: { messageId: 'fallback-id', position: 42 },
      anchorStatus: 'normal' as const,
      feedId: 'feed-fallback',
      hasMoreAfter: false,
      hasMoreBefore: false,
      total: 0,
      messages: [],
    }

    const anchor = getDemoRespAnchor(resp)
    expect(anchor.messageId).toBe('fallback-id')
    expect(anchor.position).toBe(42)
  })
})
