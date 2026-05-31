import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageList } from '../../react/components/MessageList'
import type { DemoMessageScenario } from '../scenario/demoScenarioTypes'
import {
  RANDOM_CHAT_FEED_ID,
  resolveDemoSessionDelayMs,
} from '../scenario/demoScenarioRuntimeHelpers'
import {
  createDemoFeedRuntimeCache,
  type DemoFeedRuntimeCache,
} from '../runtime/useDemoFeedRuntimeCache'
import { useDemoMessageScenario } from '../scenario/useDemoMessageScenario'

describe('useDemoMessageScenario feed switching', () => {
  let cache: DemoFeedRuntimeCache | null = null

  afterEach(() => {
    vi.restoreAllMocks()
    cache?.destroyAll()
    cache = null
  })

  it('consumes the first staged feed edge request instead of stranding loading', async () => {
    cache = createDemoFeedRuntimeCache()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    function Harness() {
      const nextScenario = useDemoMessageScenario(cache as DemoFeedRuntimeCache)
      scenario = nextScenario

      return (
        <MessageList
          runtime={nextScenario.activeRuntime}
          renderRow={({ row }) => <span>{row?.id}</span>}
          renderBeforeEdge={() =>
            nextScenario.loadingBefore ? (
              <div data-testid="before-loading" />
            ) : null
          }
          renderAfterEdge={() =>
            nextScenario.loadingAfter ? (
              <div data-testid="after-loading" />
            ) : null
          }
        />
      )
    }

    await act(async () => {
      root.render(<Harness />)
    })
    await waitFor(() =>
      Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    )

    await act(async () => {
      scenario?.deferNextEdgeResponse(500)
      scenario?.selectFeed('feed-design')
    })
    await waitFor(() =>
      Boolean(scenario && scenario.activeFeedId === 'feed-design' && !scenario.feedLoading)
    )

    const feedRuntime = cache.getRuntime('feed-design')
    await waitFor(() =>
      feedRuntime.getSnapshot().edgeState.before.status === 'loading'
    )

    expect(host.querySelector('[data-testid="before-loading"]')).toBeNull()
    expect(host.querySelector('[data-testid="after-loading"]')).toBeNull()

    await waitFor(() =>
      feedRuntime.getSnapshot().edgeState.before.status !== 'loading'
    )

    expect(feedRuntime.getSnapshot().edgeState.before.status).not.toBe('loading')

    await act(async () => {
      root.unmount()
    })
  })

  it('maps Random Chat entry rolls to slow, fast, and immediate paths', () => {
    const random = vi.spyOn(Math, 'random')

    random.mockReturnValue(0.49)
    expect(resolveDemoSessionDelayMs(RANDOM_CHAT_FEED_ID)).toBeGreaterThan(200)

    random.mockReturnValue(0.5)
    expect(resolveDemoSessionDelayMs(RANDOM_CHAT_FEED_ID)).toBe(150)

    random.mockReturnValue(0.79)
    expect(resolveDemoSessionDelayMs(RANDOM_CHAT_FEED_ID)).toBe(150)

    random.mockReturnValue(0.8)
    expect(resolveDemoSessionDelayMs(RANDOM_CHAT_FEED_ID)).toBe(0)

    random.mockReturnValue(0.2)
    expect(resolveDemoSessionDelayMs('feed-design')).toBe(0)
  })

  it('keeps slow Random Chat entry pending long enough to show the session overlay', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.4)
    cache = createDemoFeedRuntimeCache()
    const harness = createScenarioHarness(cache)

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    await act(async () => {
      harness.getScenario()?.selectFeed(RANDOM_CHAT_FEED_ID)
    })

    expect(harness.getScenario()?.selectedFeedId).toBe(RANDOM_CHAT_FEED_ID)
    expect(harness.getScenario()?.activeFeedId).toBe(RANDOM_CHAT_FEED_ID)
    expect(harness.getScenario()?.activeRuntime.getSnapshot().feedId)
      .toBe(RANDOM_CHAT_FEED_ID)
    expect(harness.getScenario()?.feedLoading).toBe(true)
    expect(harness.host.textContent).not.toContain('feed-runtime-')

    await waitFor(() =>
      Boolean(harness.getScenario()?.sessionLoadingOverlayVisible),
    )

    expect(
      harness.host.querySelector('[data-testid="session-loading-overlay"]'),
    ).not.toBeNull()
    expect(
      harness.host.querySelector('[data-testid="session-loading-spinner"]'),
    ).not.toBeNull()
    expect(
      harness.host.querySelector('.message-viewport.session-loading'),
    ).not.toBeNull()

    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(
        scenario &&
          scenario.activeFeedId === RANDOM_CHAT_FEED_ID &&
          !scenario.feedLoading,
      )
    })

    expect(harness.getScenario()?.sessionLoadingOverlayVisible).toBe(false)

    await harness.unmount()
  })

  it('completes fast Random Chat entry without showing the session overlay', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.6)
    cache = createDemoFeedRuntimeCache()
    const harness = createScenarioHarness(cache)

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    await act(async () => {
      harness.getScenario()?.selectFeed(RANDOM_CHAT_FEED_ID)
    })

    expect(harness.getScenario()?.activeFeedId).toBe(RANDOM_CHAT_FEED_ID)
    expect(harness.getScenario()?.feedLoading).toBe(true)
    expect(harness.host.textContent).not.toContain('feed-runtime-')

    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(
        scenario &&
          scenario.activeFeedId === RANDOM_CHAT_FEED_ID &&
          !scenario.feedLoading,
      )
    })
    await wait(120)

    expect(harness.getScenario()?.sessionLoadingOverlayVisible).toBe(false)
    expect(
      harness.host.querySelector('[data-testid="session-loading-overlay"]'),
    ).toBeNull()

    await harness.unmount()
  })

  it('activates Random Chat immediately on the cache-hit path', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    cache = createDemoFeedRuntimeCache()
    const harness = createScenarioHarness(cache)

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    await act(async () => {
      harness.getScenario()?.selectFeed(RANDOM_CHAT_FEED_ID)
    })
    await wait(240)

    expect(harness.getScenario()?.activeFeedId).toBe(RANDOM_CHAT_FEED_ID)
    expect(harness.getScenario()?.feedLoading).toBe(false)
    expect(harness.getScenario()?.sessionLoadingOverlayVisible).toBe(false)

    await harness.unmount()
  })
})

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return
    }

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25))
    })
  }

  expect(condition()).toBe(true)
}

function createScenarioHarness(runtimeCache: DemoFeedRuntimeCache): {
  host: HTMLElement
  getScenario: () => DemoMessageScenario | null
  render: () => Promise<void>
  unmount: () => Promise<void>
} {
  const host = document.createElement('div')
  const root = createRoot(host)
  let scenario: DemoMessageScenario | null = null

  function Harness() {
    const nextScenario = useDemoMessageScenario(runtimeCache)
    scenario = nextScenario

    return (
      <MessageList
        runtime={nextScenario.activeRuntime}
        className={[
          'message-viewport',
          nextScenario.feedLoading ? 'session-loading' : '',
        ].filter(Boolean).join(' ')}
        renderRow={({ row }) => <span>{row?.id}</span>}
        renderBeforeEdge={() =>
          nextScenario.loadingBefore ? (
            <div data-testid="before-loading" />
          ) : null
        }
        renderAfterEdge={() =>
          nextScenario.loadingAfter ? (
            <div data-testid="after-loading" />
          ) : null
        }
        renderOverlay={() =>
          nextScenario.sessionLoadingOverlayVisible ? (
            <div
              data-testid="session-loading-overlay"
              role="status"
              aria-label="Loading messages"
            >
              <span data-testid="session-loading-spinner" aria-hidden="true" />
            </div>
          ) : null
        }
      />
    )
  }

  return {
    host,
    getScenario: () => scenario,
    render: async () => {
      await act(async () => {
        root.render(<Harness />)
      })
    },
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
    },
  }
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, ms))
  })
}
