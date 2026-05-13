import { useEffect } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageViewportRuntime } from '../../runtime'
import { createDemoMessages, type DemoMessage } from '../demoData'
import {
  type PersistedDemoFeed,
  loadPersistedDemoFeed,
  savePersistedDemoFeed,
  writeDemoLog,
} from '../demoLocalStoreClient'
import {
  type DemoMessageScenario,
  useDemoMessageScenario,
} from '../useDemoMessageScenario'

vi.mock('../demoLocalStoreClient', () => ({
  loadPersistedDemoFeed: vi.fn(),
  savePersistedDemoFeed: vi.fn(),
  writeDemoLog: vi.fn(),
  createDemoRequestId: vi.fn((operation: string) => `${operation}:test`),
}))

const mockLoadPersistedDemoFeed = vi.mocked(loadPersistedDemoFeed)
const mockSavePersistedDemoFeed = vi.mocked(savePersistedDemoFeed)
const mockWriteDemoLog = vi.mocked(writeDemoLog)

type RuntimeStub = Pick<
  MessageViewportRuntime<DemoMessage>,
  'setDataSnapshot' | 'dispatch' | 'subscribeEvent'
>

function makeFeed(feedId: string, count: number): PersistedDemoFeed {
  return {
    version: 1,
    feedId,
    revision: 1,
    hasMoreBefore: count > 0,
    messages: createDemoMessages(count, feedId),
    updatedAt: new Date().toISOString(),
  }
}

function createRuntimeStub(): RuntimeStub {
  return {
    setDataSnapshot: vi.fn(),
    dispatch: vi.fn(),
    subscribeEvent: vi.fn(() => () => undefined),
  }
}

function TestHarness({
  runtime,
  onScenario,
}: {
  runtime: RuntimeStub
  onScenario: (scenario: DemoMessageScenario) => void
}) {
  const scenario = useDemoMessageScenario(
    runtime as MessageViewportRuntime<DemoMessage>,
  )

  useEffect(() => {
    onScenario(scenario)
  }, [onScenario, scenario])

  return null
}

async function flushTimers(timeoutMs: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(timeoutMs)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useDemoMessageScenario', () => {
  const store = new Map<string, PersistedDemoFeed>()

  beforeEach(() => {
    vi.useFakeTimers()
    store.clear()
    store.set('feed-runtime', makeFeed('feed-runtime', 40))
    store.set('feed-release', makeFeed('feed-release', 300))

    mockLoadPersistedDemoFeed.mockImplementation(async (feedId) => {
      const feed = store.get(feedId)
      return feed ? structuredClone(feed) : null
    })
    mockSavePersistedDemoFeed.mockImplementation(async (feed) => {
      store.set(feed.feedId, structuredClone(feed))
    })
    mockWriteDemoLog.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('stops requesting older history when BFF reports hasMoreBefore false', async () => {
    const runtime = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    await act(async () => {
      root.render(
        <TestHarness runtime={runtime} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })

    await flushTimers(180)
    expect(scenario?.activeFeedId).toBe('feed-runtime')

    await act(async () => {
      scenario?.selectFeed('feed-release')
    })
    await flushTimers(180)

    expect(scenario?.activeFeedId).toBe('feed-release')
    expect(scenario?.messageCount).toBe(300)
    expect(scenario?.loadedMessageCount).toBe(20)

    for (let index = 0; index < 14; index += 1) {
      await act(async () => {
        scenario?.loadHistoryBatch('manual')
      })
      await flushTimers(300)
    }

    expect(scenario?.messageCount).toBe(300)
    expect(scenario?.loadedMessageCount).toBe(300)

    const beforeExtraLoad = store.get('feed-release')
    expect(beforeExtraLoad?.messages).toHaveLength(300)

    await act(async () => {
      scenario?.loadHistoryBatch('manual')
    })
    await Promise.resolve()

    expect(scenario?.lastEvent).toBe('no older messages')
    expect(store.get('feed-release')?.messages).toHaveLength(300)
  })
})
