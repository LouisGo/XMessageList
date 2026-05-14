import { useEffect } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AnchorState,
  MessageViewportRuntime,
  MessageViewportRuntimeEvent,
} from '../../runtime'
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
  'setDataSnapshot' | 'dispatch' | 'subscribeEvent' | 'getViewportAnchorState'
>

type RuntimeStubController = {
  runtime: RuntimeStub
  emitEvent: (event: MessageViewportRuntimeEvent) => void
}

function makeFeed(
  feedId: string,
  count: number,
  options: {
    lastViewportAnchor?: PersistedDemoFeed['lastViewportAnchor']
  } = {},
): PersistedDemoFeed {
  return {
    version: 1,
    feedId,
    revision: 1,
    hasMoreBefore: count > 0,
    lastViewportAnchor: options.lastViewportAnchor,
    messages: createDemoMessages(count, feedId),
    updatedAt: new Date().toISOString(),
  }
}

function createRuntimeStub(
  viewportAnchor: AnchorState | null = null,
): RuntimeStubController {
  let listener: ((event: MessageViewportRuntimeEvent) => void) | null = null

  return {
    runtime: {
    setDataSnapshot: vi.fn(),
    dispatch: vi.fn(),
    subscribeEvent: vi.fn((nextListener) => {
      listener = nextListener
      return () => {
        listener = null
      }
    }),
    getViewportAnchorState: vi.fn(() => viewportAnchor),
    },
    emitEvent: (event) => {
      listener?.(event)
    },
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
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('stops requesting older history when BFF reports hasMoreBefore false', async () => {
    const { runtime } = createRuntimeStub()
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

  it('keeps overlapping append operations visible instead of overwriting pending state', async () => {
    const { runtime } = createRuntimeStub()
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
    expect(scenario?.pendingOperation).toBe('idle')

    await act(async () => {
      scenario?.appendLongBurst()
      scenario?.appendMessage()
    })

    expect(scenario?.pendingOperation).toBe('message.longBurst + message.append')

    await flushTimers(100)
    expect(scenario?.pendingOperation).toBe('message.longBurst')

    await flushTimers(520)
    expect(scenario?.pendingOperation).toBe('idle')
    expect(scenario?.messageCount).toBe(45)
    expect(scenario?.loadedMessageCount).toBe(25)
    expect(store.get('feed-runtime')?.messages).toHaveLength(45)
  })

  it('bootstraps restored feeds with a bounded window and pages newer history from runtime edge events', async () => {
    const restoredAnchor = {
      messageId: 'feed-runtime-m-32',
      position: 32,
      offsetWithinMessage: 24,
    }
    const { runtime, emitEvent } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    store.set('feed-runtime', makeFeed('feed-runtime', 80, {
      lastViewportAnchor: restoredAnchor,
    }))

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
    expect(scenario?.loadedMessageCount).toBe(31)
    expect(runtime.dispatch).toHaveBeenCalledWith({
      type: 'bootstrap',
      mode: 'restored',
      target: {
        key: {
          kind: 'committed',
          messageId: restoredAnchor.messageId,
        },
        offsetWithinMessage: restoredAnchor.offsetWithinMessage,
      },
    })

    await act(async () => {
      emitEvent({
        type: 'needMoreAfter',
        feedId: 'feed-runtime',
        generation: 2,
        reason: 'near-bottom',
      })
      emitEvent({
        type: 'needMoreAfter',
        feedId: 'feed-runtime',
        generation: 2,
        reason: 'near-bottom',
      })
    })
    await flushTimers(220)

    expect(scenario?.loadedMessageCount).toBe(51)
    expect(scenario?.lastEvent).toBe('loaded 20 newer messages')
    expect(runtime.dispatch).not.toHaveBeenCalledWith({ type: 'followBottom' })
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'history.append',
        phase: 'success',
        details: expect.objectContaining({ source: 'edge-user' }),
      }),
    )
  })

  it('drains newer pages before following bottom when the user explicitly requests latest', async () => {
    const restoredAnchor = {
      messageId: 'feed-runtime-m-32',
      position: 32,
      offsetWithinMessage: 24,
    }
    const { runtime } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    store.set('feed-runtime', makeFeed('feed-runtime', 80, {
      lastViewportAnchor: restoredAnchor,
    }))

    await act(async () => {
      root.render(
        <TestHarness runtime={runtime} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })

    await flushTimers(180)
    expect(scenario?.loadedMessageCount).toBe(31)

    await act(async () => {
      scenario?.followBottom('sidebar')
    })
    await flushTimers(220)
    await flushTimers(220)

    expect(scenario?.loadedMessageCount).toBe(59)
    expect(runtime.dispatch).toHaveBeenLastCalledWith({ type: 'followBottom' })
  })

  it('persists edit, delete, and reaction mutations for loaded messages', async () => {
    const { runtime } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    vi.spyOn(Math, 'random').mockReturnValue(0)

    await act(async () => {
      root.render(
        <TestHarness runtime={runtime} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })

    await flushTimers(180)

    const loadedTail = store.get('feed-runtime')?.messages.slice(-20) ?? []
    const selfMessage = loadedTail.find((message) => message.tone === 'self')
    const peerMessage = loadedTail.find(
      (message) => message.id !== selfMessage?.id,
    )

    expect(selfMessage).toBeDefined()
    expect(peerMessage).toBeDefined()

    await act(async () => {
      scenario?.editMessage(selfMessage?.id ?? '', 'edited body from test')
    })
    await flushTimers(100)

    const edited = store.get('feed-runtime')?.messages.find(
      (message) => message.id === selfMessage?.id,
    )
    expect(edited?.body).toBe('edited body from test')
    expect(edited?.editedAt).toBeTruthy()

    await act(async () => {
      scenario?.reactToMessage(selfMessage?.id ?? '')
    })
    await flushTimers(70)

    const reacted = store.get('feed-runtime')?.messages.find(
      (message) => message.id === selfMessage?.id,
    )
    expect(reacted?.reactions).toEqual(['😀'])

    await act(async () => {
      scenario?.deleteMessage(peerMessage?.id ?? '')
    })
    await flushTimers(90)

    expect(
      store.get('feed-runtime')?.messages.some(
        (message) => message.id === peerMessage?.id,
      ),
    ).toBe(false)
    expect(scenario?.messageCount).toBe(39)
    expect(scenario?.loadedMessageCount).toBe(19)
  })

  it('keeps the restored window contiguous when new messages arrive after the current window', async () => {
    const restoredAnchor = {
      messageId: 'feed-runtime-m-32',
      position: 32,
      offsetWithinMessage: 24,
    }
    const { runtime } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    store.set('feed-runtime', makeFeed('feed-runtime', 80, {
      lastViewportAnchor: restoredAnchor,
    }))

    await act(async () => {
      root.render(
        <TestHarness runtime={runtime} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })

    await flushTimers(180)

    expect(scenario?.loadedMessageCount).toBe(31)
    expect(scenario?.messageCount).toBe(80)

    await act(async () => {
      scenario?.appendMessage()
    })
    await flushTimers(90)

    expect(scenario?.messageCount).toBe(81)
    expect(scenario?.loadedMessageCount).toBe(31)
    expect(scenario?.lastEvent).toContain('after current window')
  })

  it('rebuilds the latest window and follows bottom when sending from a restored middle window', async () => {
    const restoredAnchor = {
      messageId: 'feed-runtime-m-32',
      position: 32,
      offsetWithinMessage: 24,
    }
    const { runtime } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    store.set('feed-runtime', makeFeed('feed-runtime', 80, {
      lastViewportAnchor: restoredAnchor,
    }))

    await act(async () => {
      root.render(
        <TestHarness runtime={runtime} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })

    await flushTimers(180)

    expect(scenario?.loadedMessageCount).toBe(31)

    await act(async () => {
      scenario?.sendMessage('send from restored middle')
    })
    await flushTimers(60)

    const latestSnapshot = vi.mocked(runtime.setDataSnapshot).mock.calls.at(-1)?.[0]
    const latestLastItem = latestSnapshot?.items.at(-1)

    expect(scenario?.messageCount).toBe(81)
    expect(scenario?.loadedMessageCount).toBe(20)
    expect(scenario?.lastEvent).toBe('sent feed-runtime-m-81 and rebuilt latest')
    expect(latestSnapshot?.hasMoreAfter).toBe(false)
    expect(latestSnapshot?.hasMoreBefore).toBe(true)
    expect(latestSnapshot?.change).toEqual({
      kind: 'reset',
      viewportEffect: 'auto-scroll-to-bottom',
    })
    expect(
      latestLastItem?.kind === 'committed'
        ? latestLastItem.key.messageId
        : undefined,
    ).toBe('feed-runtime-m-81')
    expect(store.get('feed-runtime')?.lastViewportAnchor).toBeUndefined()
  })

  it('persists the current viewport anchor when requested', async () => {
    const { runtime } = createRuntimeStub({
      key: { kind: 'committed', messageId: 'feed-runtime-m-22' },
      offsetWithinMessage: 18,
    })
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

    await act(async () => {
      scenario?.rememberViewportAnchor('scroll-idle')
      await Promise.resolve()
    })

    const persisted = store.get('feed-runtime')
    expect(persisted?.lastViewportAnchor).toEqual({
      messageId: 'feed-runtime-m-22',
      position: 22,
      offsetWithinMessage: 18,
    })
  })
})
