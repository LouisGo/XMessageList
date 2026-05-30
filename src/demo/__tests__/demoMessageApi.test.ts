import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDemoMessages, createNewestMessage } from '../data/demoData'
import type { PersistedDemoFeed } from '../data/demoLocalStoreClient'

const localStoreMocks = vi.hoisted(() => ({
  loadPersistedDemoFeed: vi.fn(),
  savePersistedDemoFeed: vi.fn(),
}))

vi.mock('../data/demoLocalStoreClient', () => ({
  loadPersistedDemoFeed: localStoreMocks.loadPersistedDemoFeed,
  savePersistedDemoFeed: localStoreMocks.savePersistedDemoFeed,
}))

import {
  appendDemoFeedMessages,
  getLatestMessages,
  getMessagesAround,
  readDemoViewportAnchor,
} from '../data/demoMessageApi'

describe('demoMessageApi persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('seeds and persists a missing feed before serving latest messages', async () => {
    const feedId = 'feed-api-seed'
    localStoreMocks.loadPersistedDemoFeed.mockResolvedValueOnce(null)
    localStoreMocks.savePersistedDemoFeed.mockResolvedValue(undefined)

    const resp = await getLatestMessages({ feedId, count: 20 })

    expect(resp.ok).toBe(true)
    expect(localStoreMocks.savePersistedDemoFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        feedId,
        version: 1,
        revision: 1,
        messages: expect.any(Array),
      }),
    )
    if (resp.ok) {
      expect(resp.messages.length).toBeGreaterThan(0)
    }
  })

  it('serves message windows from the persisted feed', async () => {
    const feedId = 'feed-api-existing'
    const feed = createPersistedFeed(feedId, 12)
    localStoreMocks.loadPersistedDemoFeed.mockResolvedValueOnce(feed)

    const resp = await getMessagesAround({
      feedId,
      anchor: {
        messageId: 'missing-message',
        position: 7,
      },
      before: 1,
      after: 1,
    })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.anchorStatus).toBe('deleted')
      expect(resp.messages.map((message) => message.sequence)).toEqual([6, 7, 8])
    }
  })

  it('writes appended mock messages back to the persisted feed', async () => {
    const feedId = 'feed-api-append'
    const feed = createPersistedFeed(feedId, 3)
    localStoreMocks.loadPersistedDemoFeed.mockResolvedValueOnce(feed)
    localStoreMocks.savePersistedDemoFeed.mockResolvedValue(undefined)
    await getLatestMessages({ feedId, count: 3 })

    const message = createNewestMessage({
      feedId,
      sequence: 4,
      quoteCandidates: feed.messages,
      random: () => 0.9,
    })
    appendDemoFeedMessages(feedId, [message])

    await vi.waitFor(() => {
      expect(localStoreMocks.savePersistedDemoFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          feedId,
          revision: 2,
          messages: expect.arrayContaining([
            expect.objectContaining({ id: message.id }),
          ]),
        }),
      )
    })
  })

  it('does not seed over persisted feeds before async hydration', async () => {
    const feedId = 'feed-api-hydrate'
    const feed = {
      ...createPersistedFeed(feedId, 205),
      revision: 7,
      lastViewportAnchor: {
        messageId: `${feedId}-0200`,
        position: 200,
        offsetWithinMessage: 12,
      },
    }
    localStoreMocks.loadPersistedDemoFeed.mockResolvedValueOnce(feed)
    localStoreMocks.savePersistedDemoFeed.mockResolvedValue(undefined)

    expect(readDemoViewportAnchor(feedId)).toBeUndefined()
    expect(localStoreMocks.savePersistedDemoFeed).not.toHaveBeenCalled()

    const resp = await getLatestMessages({ feedId, count: 20 })

    expect(resp.ok).toBe(true)
    if (resp.ok) {
      expect(resp.total).toBe(205)
      expect(resp.messages.at(-1)?.id).toBe(`${feedId}-0205`)
    }
    expect(localStoreMocks.savePersistedDemoFeed).not.toHaveBeenCalled()
  })
})

function createPersistedFeed(feedId: string, count: number): PersistedDemoFeed {
  return {
    version: 1,
    feedId,
    revision: 1,
    hasMoreBefore: true,
    messages: createDemoMessages(count, feedId),
    updatedAt: new Date().toISOString(),
  }
}
