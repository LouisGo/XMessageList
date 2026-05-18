import { useEffect, useMemo } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AnchorState,
  MessageViewportSnapshot,
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
import type { DemoFeedRuntimeCache } from '../useDemoFeedRuntimeCache'

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
  | 'setDataSnapshot'
  | 'dispatch'
  | 'subscribeEvent'
  | 'getViewportAnchorState'
  | 'getSnapshot'
>

type RuntimeStubController = {
  runtime: RuntimeStub
  emitEvent: (event: MessageViewportRuntimeEvent) => void
}

function createRuntimeCacheStub(runtime: RuntimeStub): DemoFeedRuntimeCache {
  return {
    getRuntime: vi.fn(() => runtime as MessageViewportRuntime<DemoMessage>),
    hasRuntime: vi.fn(() => true),
    deleteRuntime: vi.fn(() => true),
    getCachedFeedIds: vi.fn(() => []),
    destroyAll: vi.fn(),
  }
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
  const snapshot: MessageViewportSnapshot<DemoMessage> = {
    feedId: 'feed-runtime',
    generation: 1,
    revision: 1,
    items: [],
    renderWindow: { startIndex: 0, endIndex: -1, itemKeys: [] },
    topSpacer: 0,
    bottomSpacer: 0,
    bottomLockState: 'UNLOCKED',
    bootstrapState: 'READY',
    viewportPhase: 'IDLE',
    edgeState: { before: 'idle', after: 'idle' },
  }

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
      getSnapshot: vi.fn(() => snapshot),
    },
    emitEvent: (event) => {
      listener?.(event)
    },
  }
}

function TestHarness({
  runtime,
  runtimeCache,
  onScenario,
}: {
  runtime?: RuntimeStub
  runtimeCache?: DemoFeedRuntimeCache
  onScenario: (scenario: DemoMessageScenario) => void
}) {
  const resolvedRuntimeCache = useMemo(
    () => runtimeCache ?? createRuntimeCacheStub(assertRuntimeStub(runtime)),
    [runtime, runtimeCache],
  )
  const scenario = useDemoMessageScenario(resolvedRuntimeCache)

  useEffect(() => {
    onScenario(scenario)
  }, [onScenario, scenario])

  return null
}

function assertRuntimeStub(runtime: RuntimeStub | undefined): RuntimeStub {
  if (!runtime) {
    throw new Error('TestHarness requires runtime or runtimeCache')
  }

  return runtime
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

  it('routes each active feed through its cached runtime', async () => {
    const runtimeFeed = createRuntimeStub()
    const runtimeRelease = createRuntimeStub()
    const runtimeByFeed = new Map<string, RuntimeStub>([
      ['feed-runtime', runtimeFeed.runtime],
      ['feed-release', runtimeRelease.runtime],
    ])
    const runtimeCache: DemoFeedRuntimeCache = {
      getRuntime: vi.fn((feedId) => {
        const runtime = runtimeByFeed.get(feedId)

        if (!runtime) {
          throw new Error(`missing runtime for ${feedId}`)
        }

        return runtime as MessageViewportRuntime<DemoMessage>
      }),
      hasRuntime: vi.fn((feedId) => runtimeByFeed.has(feedId)),
      deleteRuntime: vi.fn((feedId) => runtimeByFeed.delete(feedId)),
      getCachedFeedIds: vi.fn(() => Array.from(runtimeByFeed.keys())),
      destroyAll: vi.fn(),
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    await act(async () => {
      root.render(
        <TestHarness runtimeCache={runtimeCache} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })
    await flushTimers(180)

    expect(scenario?.activeFeedId).toBe('feed-runtime')
    expect(scenario?.activeRuntime).toBe(runtimeFeed.runtime)
    expect(runtimeFeed.runtime.setDataSnapshot).toHaveBeenCalled()
    expect(runtimeFeed.runtime.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrap', mode: 'latest' }),
    )

    await act(async () => {
      scenario?.selectFeed('feed-release')
    })

    expect(scenario?.selectedFeedId).toBe('feed-release')
    expect(scenario?.pendingFeedId).toBe('feed-release')
    expect(scenario?.activeFeedId).toBe('feed-runtime')
    expect(scenario?.activeRuntime).toBe(runtimeFeed.runtime)
    expect(runtimeRelease.runtime.setDataSnapshot).not.toHaveBeenCalled()

    await flushTimers(180)

    expect(scenario?.activeFeedId).toBe('feed-release')
    expect(scenario?.selectedFeedId).toBe('feed-release')
    expect(scenario?.pendingFeedId).toBeNull()
    expect(scenario?.activeRuntime).toBe(runtimeRelease.runtime)
    expect(runtimeRelease.runtime.setDataSnapshot).toHaveBeenCalled()
    expect(runtimeRelease.runtime.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bootstrap', mode: 'latest' }),
    )
    expect(runtimeCache.getRuntime).toHaveBeenCalledWith('feed-runtime')
    expect(runtimeCache.getRuntime).toHaveBeenCalledWith('feed-release')

    const feedRuntimeSnapshotCalls = vi.mocked(
      runtimeFeed.runtime.setDataSnapshot,
    ).mock.calls.length
    const feedRuntimeDispatchCalls = vi.mocked(
      runtimeFeed.runtime.dispatch,
    ).mock.calls.length

    await act(async () => {
      scenario?.selectFeed('feed-runtime')
    })

    expect(scenario?.activeFeedId).toBe('feed-runtime')
    expect(scenario?.selectedFeedId).toBe('feed-runtime')
    expect(scenario?.pendingFeedId).toBeNull()
    expect(scenario?.activeRuntime).toBe(runtimeFeed.runtime)
    await flushTimers(180)

    expect(runtimeFeed.runtime.setDataSnapshot).toHaveBeenCalledTimes(
      feedRuntimeSnapshotCalls,
    )
    expect(runtimeFeed.runtime.dispatch).toHaveBeenCalledTimes(
      feedRuntimeDispatchCalls,
    )
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'feed.load',
        phase: 'skip',
        feedId: 'feed-runtime',
        details: expect.objectContaining({ reason: 'runtime-cache-hit' }),
      }),
    )
  })

  it('reloads a cached runtime on feed switch when its spacer is too large', async () => {
    const runtimeFeed = createRuntimeStub()
    const runtimeFeedReload = createRuntimeStub()
    const runtimeRelease = createRuntimeStub()
    vi.mocked(runtimeFeed.runtime.getSnapshot).mockReturnValue({
      feedId: 'feed-runtime',
      generation: 1,
      revision: 1,
      items: [],
      renderWindow: { startIndex: 0, endIndex: -1, itemKeys: [] },
      topSpacer: 0,
      bottomSpacer: 12_001,
      bottomLockState: 'UNLOCKED',
      bootstrapState: 'READY',
      viewportPhase: 'IDLE',
      edgeState: { before: 'idle', after: 'idle' },
    })
    const runtimeByFeed = new Map<string, RuntimeStub>([
      ['feed-runtime', runtimeFeed.runtime],
      ['feed-release', runtimeRelease.runtime],
    ])
    const runtimeCache: DemoFeedRuntimeCache = {
      getRuntime: vi.fn((feedId) => {
        if (feedId === 'feed-runtime' && !runtimeByFeed.has(feedId)) {
          runtimeByFeed.set(feedId, runtimeFeedReload.runtime)
        }

        const runtime = runtimeByFeed.get(feedId)

        if (!runtime) {
          throw new Error(`missing runtime for ${feedId}`)
        }

        return runtime as MessageViewportRuntime<DemoMessage>
      }),
      hasRuntime: vi.fn((feedId) => runtimeByFeed.has(feedId)),
      deleteRuntime: vi.fn((feedId) => runtimeByFeed.delete(feedId)),
      getCachedFeedIds: vi.fn(() => Array.from(runtimeByFeed.keys())),
      destroyAll: vi.fn(),
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    await act(async () => {
      root.render(
        <TestHarness runtimeCache={runtimeCache} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })
    await flushTimers(180)

    await act(async () => {
      scenario?.selectFeed('feed-release')
    })
    await flushTimers(180)

    await act(async () => {
      scenario?.selectFeed('feed-runtime')
    })

    expect(runtimeCache.deleteRuntime).toHaveBeenCalledWith('feed-runtime')
    expect(scenario?.pendingFeedId).toBe('feed-runtime')
    expect(scenario?.activeRuntime).toBe(runtimeRelease.runtime)

    await flushTimers(180)

    expect(scenario?.activeRuntime).toBe(runtimeFeedReload.runtime)
    expect(runtimeFeedReload.runtime.setDataSnapshot).toHaveBeenCalled()
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'feed.select',
        feedId: 'feed-release',
        details: expect.objectContaining({
          nextFeedId: 'feed-runtime',
          runtimeCacheHit: false,
          cacheRebuildReason: 'spacer-threshold',
        }),
      }),
    )
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
    expect(scenario?.loadingAfter).toBe(false)
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

  it('loads the latest window instead of draining newer pages when the user requests bottom', async () => {
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
    expect(scenario?.loadedMessageCount).toBe(31)

    await act(async () => {
      scenario?.followBottom('sidebar')
      emitEvent({
        type: 'needLatestMessages',
        feedId: 'feed-runtime',
        generation: 2,
        reason: 'bottom-follow',
      })
    })
    expect(scenario?.loadingAfter).toBe(false)
    await flushTimers(220)

    expect(scenario?.loadedMessageCount).toBe(20)
    expect(scenario?.loadingAfter).toBe(false)
    expect(runtime.dispatch).toHaveBeenLastCalledWith({ type: 'followBottom' })
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'history.latest',
        phase: 'success',
        details: expect.objectContaining({
          source: 'follow-bottom',
          hasMoreAfter: false,
          loaded: 20,
        }),
      }),
    )
    expect(mockWriteDemoLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'history.append',
        details: expect.objectContaining({ source: 'follow-bottom' }),
      }),
    )
  })

  it('loads an around-target window when runtime asks for a far jump target', async () => {
    const { runtime, emitEvent } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    store.set('feed-runtime', makeFeed('feed-runtime', 120))

    await act(async () => {
      root.render(
        <TestHarness runtime={runtime} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })

    await flushTimers(180)
    expect(scenario?.loadedMessageCount).toBe(20)

    await act(async () => {
      emitEvent({
        type: 'needMessagesAround',
        feedId: 'feed-runtime',
        generation: 2,
        reason: 'jump',
        target: { messageId: 'feed-runtime-m-72', position: 72 },
      })
    })
    expect(scenario?.loadingAfter).toBe(false)
    await flushTimers(220)

    expect(scenario?.loadedMessageCount).toBe(41)
    expect(scenario?.loadingAfter).toBe(false)
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'history.around',
        phase: 'start',
        details: expect.objectContaining({
          intent: 'jump',
          target: { messageId: 'feed-runtime-m-72', position: 72 },
          before: 20,
          after: 20,
        }),
      }),
    )
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'history.around',
        phase: 'success',
        details: expect.objectContaining({
          intent: 'jump',
          loaded: 41,
          hasMoreBefore: true,
          hasMoreAfter: true,
          target: { messageId: 'feed-runtime-m-72', position: 72 },
        }),
      }),
    )
    expect(mockWriteDemoLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'history.append',
        details: expect.objectContaining({ source: 'follow-bottom' }),
      }),
    )
  })

  it('publishes deleted around-target fallback anchor to runtime', async () => {
    const { runtime, emitEvent } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    const feed = makeFeed('feed-runtime', 42)
    feed.messages = feed.messages.filter(
      (message) => message.id !== 'feed-runtime-m-17',
    )
    store.set('feed-runtime', feed)

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
      emitEvent({
        type: 'needMessagesAround',
        feedId: 'feed-runtime',
        generation: 2,
        reason: 'jump',
        target: { messageId: 'feed-runtime-m-17', position: 17 },
      })
    })
    await flushTimers(220)

    const latestSnapshot = vi.mocked(runtime.setDataSnapshot).mock.calls.at(-1)?.[0]

    expect(scenario?.loadedMessageCount).toBe(36)
    expect(latestSnapshot?.anchorStatus).toBe('deleted')
    expect(latestSnapshot?.anchor).toEqual({
      messageId: 'feed-runtime-m-16',
      position: 16,
    })
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'history.around',
        phase: 'success',
        details: expect.objectContaining({
          target: { messageId: 'feed-runtime-m-17', position: 17 },
          anchor: { messageId: 'feed-runtime-m-16', position: 16 },
          anchorStatus: 'deleted',
        }),
      }),
    )
  })

  it('dispatches quote clicks as runtime jump commands only', async () => {
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

    act(() => {
      scenario?.jumpToQuote({
        origin: {
          messageId: 'feed-runtime-m-32',
          position: 32,
        },
        target: {
          messageId: 'feed-runtime-m-12',
          position: 12,
        },
      })
    })

    expect(runtime.dispatch).toHaveBeenCalledWith({
      type: 'jump',
      origin: {
        messageId: 'feed-runtime-m-32',
        position: 32,
      },
      target: {
        messageId: 'feed-runtime-m-12',
        position: 12,
      },
    })
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'runtime.command.quoteJump',
        phase: 'info',
        details: {
          origin: {
            messageId: 'feed-runtime-m-32',
            position: 32,
          },
          target: {
            messageId: 'feed-runtime-m-12',
            position: 12,
          },
        },
      }),
    )
    expect(mockWriteDemoLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'history.around',
      }),
    )
  })

  it('highlights a message after runtime settles a jump destination', async () => {
    const { runtime, emitEvent } = createRuntimeStub()
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

    act(() => {
      emitEvent({
        type: 'destinationSettled',
        feedId: 'feed-runtime',
        generation: 2,
        intent: 'jump',
        target: { messageId: 'feed-runtime-m-12', position: 12 },
        resolution: 'target',
      })
    })

    expect(scenario?.highlightedMessageId).toBe('feed-runtime-m-12')
    expect(scenario?.highlightToken).toBe(1)

    await flushTimers(1400)

    expect(scenario?.highlightedMessageId).toBeNull()
  })

  it('does not highlight when a deleted quote target falls back', async () => {
    const { runtime, emitEvent } = createRuntimeStub()
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
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

    act(() => {
      emitEvent({
        type: 'destinationSettled',
        feedId: 'feed-runtime',
        generation: 2,
        intent: 'jump',
        target: { messageId: 'feed-runtime-m-17', position: 17 },
        resolution: 'fallback-deleted',
        resolvedTarget: { messageId: 'feed-runtime-m-14', position: 14 },
      })
    })

    expect(scenario?.highlightedMessageId).toBeNull()
    expect(alertSpy).toHaveBeenCalledWith(
      'Quoted message was deleted. Jumped to a nearby message.',
    )
    expect(scenario?.lastEvent).toBe(
      'quoted message was deleted; jumped to nearby message',
    )
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

  it('toggles advanced event storm as a continuous tail event stream', async () => {
    const { runtime } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    await act(async () => {
      root.render(
        <TestHarness runtime={runtime} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })
    await flushTimers(180)

    expect(scenario?.messageCount).toBe(40)
    expect(scenario?.eventStormRunning).toBe(false)

    await act(async () => {
      scenario?.toggleEventStorm()
    })

    expect(scenario?.eventStormRunning).toBe(true)
    expect(scenario?.pendingOperation).toBe('mock.eventStorm')

    await flushTimers(80)

    expect(scenario?.messageCount).toBeGreaterThan(40)
    expect(scenario?.loadedMessageCount).toBeGreaterThan(20)

    await flushTimers(1_000)

    expect(scenario?.eventStormRunning).toBe(true)

    await act(async () => {
      scenario?.toggleEventStorm()
      await Promise.resolve()
    })

    expect(scenario?.eventStormRunning).toBe(false)
    expect(scenario?.pendingOperation).toBe('idle')
    expect(scenario?.lastEvent).toBe('event storm stopped')
    expect(scenario?.messageCount).toBeGreaterThan(40)
    expect(
      vi.mocked(runtime.setDataSnapshot).mock.calls.some(([snapshot]) =>
        snapshot.change.viewportEffect === 'append',
      ),
    ).toBe(true)
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'mock.eventStorm',
        phase: 'success',
        details: expect.objectContaining({ reason: 'toggle-off' }),
      }),
    )
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'message.append',
        phase: 'success',
        details: expect.objectContaining({ source: 'mock.eventStorm' }),
      }),
    )
  })

  it('toggles bot push as a focused-feed append stream', async () => {
    const { runtime } = createRuntimeStub()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    vi.spyOn(Math, 'random').mockReturnValue(0.49)

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
      scenario?.toggleBotPush()
      await Promise.resolve()
    })

    expect(scenario?.botPushActive).toBe(true)
    expect(scenario?.pendingOperation).toBe('mock.botPush')
    expect(scenario?.messageCount).toBe(42)
    expect(scenario?.loadedMessageCount).toBe(22)

    await flushTimers(1_000)

    expect(scenario?.botPushActive).toBe(true)
    expect(scenario?.messageCount).toBe(44)
    expect(scenario?.loadedMessageCount).toBe(24)
    expect(
      store.get('feed-runtime')?.messages.slice(-4).some(
        (message) => message.kind !== 'text',
      ),
    ).toBe(true)

    await act(async () => {
      scenario?.toggleBotPush()
    })

    expect(scenario?.botPushActive).toBe(false)
    expect(scenario?.pendingOperation).toBe('idle')

    const messageCountAfterStop = scenario?.messageCount

    await flushTimers(3_000)

    expect(scenario?.messageCount).toBe(messageCountAfterStop)
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'mock.botPush',
        phase: 'success',
        details: expect.objectContaining({ reason: 'toggle-off' }),
      }),
    )
    expect(mockWriteDemoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'message.append',
        phase: 'success',
        details: expect.objectContaining({ source: 'mock.botPush' }),
      }),
    )
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
      scenario?.rememberRuntimeViewportAnchor({
        type: 'viewportAnchorChanged',
        feedId: 'feed-runtime',
        generation: 2,
        reason: 'scroll-idle',
        anchor: {
          key: { kind: 'committed', messageId: 'feed-runtime-m-22' },
          offsetWithinMessage: 18,
        },
      })
      await Promise.resolve()
    })

    const persisted = store.get('feed-runtime')
    expect(persisted?.lastViewportAnchor).toEqual({
      messageId: 'feed-runtime-m-22',
      position: 22,
      offsetWithinMessage: 18,
    })
  })

  it('persists detach anchors to the event feed after the active feed changes', async () => {
    const runtimeFeed = createRuntimeStub()
    const runtimeRelease = createRuntimeStub()
    const runtimeByFeed = new Map<string, RuntimeStub>([
      ['feed-runtime', runtimeFeed.runtime],
      ['feed-release', runtimeRelease.runtime],
    ])
    const runtimeCache: DemoFeedRuntimeCache = {
      getRuntime: vi.fn((feedId) => {
        const runtime = runtimeByFeed.get(feedId)

        if (!runtime) {
          throw new Error(`missing runtime for ${feedId}`)
        }

        return runtime as MessageViewportRuntime<DemoMessage>
      }),
      hasRuntime: vi.fn((feedId) => runtimeByFeed.has(feedId)),
      deleteRuntime: vi.fn((feedId) => runtimeByFeed.delete(feedId)),
      getCachedFeedIds: vi.fn(() => Array.from(runtimeByFeed.keys())),
      destroyAll: vi.fn(),
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    await act(async () => {
      root.render(
        <TestHarness runtimeCache={runtimeCache} onScenario={(next) => {
          scenario = next
        }}
        />,
      )
    })
    await flushTimers(180)

    await act(async () => {
      scenario?.selectFeed('feed-release')
    })
    await flushTimers(180)

    expect(scenario?.activeFeedId).toBe('feed-release')

    await act(async () => {
      scenario?.rememberRuntimeViewportAnchor({
        type: 'viewportAnchorChanged',
        feedId: 'feed-runtime',
        generation: 2,
        reason: 'detach',
        anchor: {
          key: { kind: 'committed', messageId: 'feed-runtime-m-22' },
          offsetWithinMessage: 18,
        },
      })
      await Promise.resolve()
    })

    expect(store.get('feed-runtime')?.lastViewportAnchor).toEqual({
      messageId: 'feed-runtime-m-22',
      position: 22,
      offsetWithinMessage: 18,
    })
    expect(store.get('feed-release')?.lastViewportAnchor).toBeUndefined()
  })
})
