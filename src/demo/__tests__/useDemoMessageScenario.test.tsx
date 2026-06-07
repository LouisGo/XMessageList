import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMessageListSessionInternals } from '../../x-message-list/core/session-registry/internal'
import { MessageList } from '../../x-message-list/react/components/MessageList'
import {
  readDemoFeedMessages,
  saveDemoViewportAnchor,
} from '../data/demoMessageApi'
import type { DemoMessageScenario } from '../scenario/demoScenarioTypes'
import {
  RANDOM_CHAT_FEED_ID,
  resolveDemoSessionDelayMs,
} from '../scenario/demoScenarioRuntimeHelpers'
import { useDemoMessageScenario } from '../scenario/useDemoMessageScenario'

describe('useDemoMessageScenario feed switching', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads history after switching feeds without stranding loading', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    let scenario: DemoMessageScenario | null = null

    function Harness() {
      const nextScenario = useDemoMessageScenario()
      scenario = nextScenario

      return (
        <MessageList
          session={nextScenario.activeSession}
          renderRow={({ row }) => <span>{row?.id}</span>}
          renderBeforeStatus={() =>
            nextScenario.loadingBefore ? (
              <div data-testid="before-loading" />
            ) : null
          }
          renderAfterStatus={() =>
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

    await act(async () => {
      scenario?.loadHistoryBatch()
    })
    await wait(220)

    await wait(360)
    await waitFor(() =>
      !scenario?.loadingBefore
    )
    expect(host.querySelector('[data-testid="before-loading"]')).toBeNull()
    expect(host.querySelector('[data-testid="after-loading"]')).toBeNull()

    await act(async () => {
      root.unmount()
    })
  })

  it('boots once under StrictMode without destroying the active session', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const errors: string[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '))
    })
    let scenario: DemoMessageScenario | null = null

    function Harness() {
      const nextScenario = useDemoMessageScenario()
      scenario = nextScenario

      return (
        <MessageList
          session={nextScenario.activeSession}
          renderRow={({ row }) => <span>{row?.id}</span>}
        />
      )
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      )
    })
    await waitFor(() =>
      Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    )

    expect(errors.join('\n')).not.toContain('Maximum update depth exceeded')

    await act(async () => {
      root.unmount()
    })
    consoleError.mockRestore()
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
    const harness = createScenarioHarness()

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
    expect(getScenarioSnapshot(harness.getScenario()).sessionId)
      .toBe(RANDOM_CHAT_FEED_ID)
    expect(harness.getScenario()?.feedLoading).toBe(true)
    expect(harness.host.textContent).not.toContain('feed-runtime-')

    await waitFor(() =>
      Boolean(harness.host.querySelector('[data-testid="session-loading-overlay"]')),
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

    await harness.unmount()
  })

  it('completes fast Random Chat entry without showing the session overlay', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.6)
    const harness = createScenarioHarness()

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

    expect(
      harness.host.querySelector('[data-testid="session-loading-overlay"]'),
    ).toBeNull()

    await harness.unmount()
  })

  it('activates Random Chat immediately on the cache-hit path', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const harness = createScenarioHarness()

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
    expect(harness.host.querySelector('[data-testid="session-loading-overlay"]')).toBeNull()

    await harness.unmount()
  })

  it('clears delayed overlay when re-entering a warm Random Chat session', async () => {
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0.9)
    const harness = createScenarioHarness()

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    await act(async () => {
      harness.getScenario()?.selectFeed(RANDOM_CHAT_FEED_ID)
    })
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(
        scenario?.activeFeedId === RANDOM_CHAT_FEED_ID &&
          !scenario.feedLoading &&
          scenario.loadedMessageCount > 0,
      )
    })

    await act(async () => {
      harness.getScenario()?.selectFeed('feed-runtime')
    })
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario?.activeFeedId === 'feed-runtime' && !scenario.feedLoading)
    })

    await act(async () => {
      harness.getScenario()?.deferNextSessionResponse(340)
      harness.getScenario()?.selectFeed(RANDOM_CHAT_FEED_ID)
    })

    expect(harness.getScenario()?.feedLoading).toBe(true)
    await wait(220)
    expect(harness.getScenario()?.feedLoading).toBe(true)
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario?.activeFeedId === RANDOM_CHAT_FEED_ID && !scenario.feedLoading)
    })

    expect(harness.host.querySelector('[data-testid="session-loading-overlay"]')).toBeNull()

    await harness.unmount()
  })

  it('keeps all visited demo feeds warm across a full feed switch cycle', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const harness = createScenarioHarness()

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    for (const feedId of [
      'feed-design',
      'feed-release',
      'feed-support',
      RANDOM_CHAT_FEED_ID,
    ]) {
      await act(async () => {
        harness.getScenario()?.selectFeed(feedId)
      })
      await waitFor(() => {
        const scenario = harness.getScenario()
        return Boolean(
          scenario?.activeFeedId === feedId &&
            !scenario.feedLoading &&
            scenario.loadedMessageCount > 0,
        )
      })
    }

    await act(async () => {
      harness.getScenario()?.selectFeed('feed-runtime')
    })
    expect(harness.getScenario()?.feedLoading).toBe(false)

    await act(async () => {
      harness.getScenario()?.selectFeed('feed-design')
    })

    expect(harness.getScenario()?.activeFeedId).toBe('feed-design')
    expect(harness.getScenario()?.feedLoading).toBe(false)
    expect(harness.host.querySelector('[data-testid="session-loading-overlay"]')).toBeNull()

    await harness.unmount()
  })

  it('restores a persisted feed anchor with its message offset', async () => {
    const harness = createScenarioHarness()
    const feedId = 'feed-support'
    const feedMessages = readDemoFeedMessages(feedId)
    const target = feedMessages[29]

    expect(target?.id).toBe('feed-support-0030')
    saveDemoViewportAnchor(feedId, {
      messageId: target.id,
      position: target.sequence,
      offsetWithinMessage: 17,
    })

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    await act(async () => {
      harness.getScenario()?.selectFeed(feedId)
    })
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(
        scenario?.activeFeedId === feedId &&
          !scenario.feedLoading &&
          getScenarioSnapshot(scenario).items.some((item) =>
            item.message?.id === target.id
          ),
      )
    })

    const scenario = harness.getScenario()
    const segment = scenario
      ? getMessageListSessionInternals(scenario.activeSession).loadedSegmentStore.getSegment()
      : null

    expect(segment?.modifier).toEqual(expect.objectContaining({
      type: 'reset-around',
      align: 'start',
      offsetWithinMessage: 17,
    }))

    await harness.unmount()
  })

  it('clears cached feed session rows and invalidates persisted anchors', async () => {
    const harness = createScenarioHarness()
    const feedId = 'feed-support'
    const feedMessages = readDemoFeedMessages(feedId)
    const target = feedMessages[29]

    expect(target?.id).toBe('feed-support-0030')
    saveDemoViewportAnchor(feedId, {
      messageId: target.id,
      position: target.sequence,
      offsetWithinMessage: 17,
    })

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    await act(async () => {
      harness.getScenario()?.selectFeed(feedId)
    })
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(
        scenario?.activeFeedId === feedId &&
          !scenario.feedLoading &&
          getScenarioSnapshot(scenario).items.some((item) =>
            item.message?.id === target.id
          ),
      )
    })

    await act(async () => {
      harness.getScenario()?.selectFeed('feed-runtime')
    })
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario?.activeFeedId === 'feed-runtime' && !scenario.feedLoading)
    })

    await act(async () => {
      harness.getScenario()?.clearFeed(feedId)
    })
    await act(async () => {
      harness.getScenario()?.selectFeed(feedId)
    })
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario?.activeFeedId === feedId && !scenario.feedLoading)
    })

    const scenario = harness.getScenario()
    expect(readDemoFeedMessages(feedId)).toEqual([])
    expect(scenario?.loadedMessageCount).toBe(0)
    expect(getScenarioSnapshot(scenario).items).toEqual([])

    await harness.unmount()
  })

  it('loads around the target when jumping to a remote quote', async () => {
    const harness = createScenarioHarness()

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    await act(async () => {
      harness.getScenario()?.jumpToQuote({
        origin: { messageId: 'feed-runtime-0070', position: 70 },
        target: { messageId: 'feed-runtime-0010', position: 10 },
      })
    })
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(getScenarioSnapshot(scenario).items.some((item) =>
        item.message?.id === 'feed-runtime-0010'
      ))
    })
    expect(harness.getScenario()?.lastEvent).toBe('loaded around anchor')

    await harness.unmount()
  })

  it('loads latest when following bottom from a middle window', async () => {
    const harness = createScenarioHarness()

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    const middle = readDemoFeedMessages('feed-runtime')[39]

    await act(async () => {
      harness.getScenario()?.activeSession.rows.resetAround({
        target: { id: middle.id },
        rows: [middle],
        hasMoreBefore: true,
        hasMoreAfter: true,
        anchor: { id: middle.id },
      })
      harness.getScenario()?.followBottom()
    })

    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(
        scenario &&
          !scenario.hasMoreAfter &&
          getScenarioSnapshot(scenario).items.at(-1)?.message?.id ===
            'feed-runtime-0080',
      )
    })

    expect(harness.getScenario()?.lastEvent).toBe('loaded 32 latest messages')

    await harness.unmount()
  })

  it('rebuilds the latest tail after sending from a middle window', async () => {
    const harness = createScenarioHarness()

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    const beforeSendCount = readDemoFeedMessages('feed-runtime').length
    await act(async () => {
      harness.getScenario()?.jumpToQuote({
        origin: { messageId: 'feed-runtime-0080', position: 80 },
        target: { messageId: 'feed-runtime-0040', position: 40 },
      })
    })
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(
        scenario?.hasMoreAfter &&
          getScenarioSnapshot(scenario).items.some((item) =>
            item.message?.id === 'feed-runtime-0040'
          ),
      )
    })

    await act(async () => {
      expect(harness.getScenario()?.sendMessage('send from middle')).toBe(true)
    })

    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(
        scenario &&
          scenario.messageCount === beforeSendCount + 1 &&
          !scenario.hasMoreAfter &&
          getScenarioSnapshot(scenario).items.at(-1)?.message?.body ===
            'send from middle',
      )
    })

    expect(harness.getScenario()?.lastEvent).toContain('rebuilt latest')

    await harness.unmount()
  })

  it('stages composer sends before the mock delivery delay', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const harness = createScenarioHarness()

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    const beforeSendCount = readDemoFeedMessages('feed-runtime').length

    await act(async () => {
      expect(harness.getScenario()?.sendMessage('instant optimistic send')).toBe(true)
    })

    const scenario = harness.getScenario()
    expect(scenario?.messageCount).toBe(beforeSendCount + 1)
    expect(
      getScenarioSnapshot(scenario).items.at(-1)?.message?.body,
    ).toBe('instant optimistic send')
    expect(
      getScenarioSnapshot(scenario).items.at(-1)?.message?.sendStatus,
    ).toBe('sending')

    await waitFor(() =>
      getScenarioSnapshot(harness.getScenario()).items.at(-1)
        ?.message?.sendStatus === 'sent'
    )

    await harness.unmount()
  })

  it('retries a failed send through a new outgoing row at the latest tail', async () => {
    const random = vi.spyOn(Math, 'random')
    random
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
    const harness = createScenarioHarness()

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    const beforeSendCount = readDemoFeedMessages('feed-runtime').length

    await act(async () => {
      expect(harness.getScenario()?.sendMessage('flaky optimistic send')).toBe(true)
    })

    const failedId = getScenarioSnapshot(harness.getScenario())
      .items.at(-1)?.message?.id

    expect(failedId).toBeTruthy()
    await waitFor(() =>
      getScenarioSnapshot(harness.getScenario()).items
        .find((item) => item.message?.id === failedId)
        ?.message?.sendStatus === 'failed'
    )
    expect(readDemoFeedMessages('feed-runtime').length).toBe(beforeSendCount + 1)

    await act(async () => {
      expect(harness.getScenario()?.retryFailedSend(failedId)).toBe(true)
    })

    const retrying = getScenarioSnapshot(harness.getScenario()).items
      .find((item) => item.message?.id === failedId)
      ?.message
    expect(retrying?.id).toBe(failedId)
    expect(retrying?.body).toBe('flaky optimistic send')
    expect(retrying?.sendStatus).toBe('retrying')
    expect(retrying?.sendAttempt).toBe(2)
    expect(
      getScenarioSnapshot(harness.getScenario()).pendingIntent,
    ).not.toBe('follow-bottom')

    await wait(250)
    expect(
      getScenarioSnapshot(harness.getScenario()).items
        .find((item) => item.message?.id === failedId)
        ?.message?.sendStatus,
    ).toBe('retrying')

    await waitFor(() =>
      getScenarioSnapshot(harness.getScenario()).items.some((item) =>
        item.message?.body === 'flaky optimistic send' &&
        item.message?.sendStatus === 'sent'
      )
    )
    const retrySent = getScenarioSnapshot(harness.getScenario()).items
      .find((item) =>
        item.message?.body === 'flaky optimistic send' &&
        item.message?.sendStatus === 'sent'
      )?.message
    expect(
      getScenarioSnapshot(harness.getScenario()).items
        .some((item) => item.message?.id === failedId),
    ).toBe(false)
    expect(
      readDemoFeedMessages('feed-runtime').filter((message) =>
        message.id === failedId
      ),
    ).toHaveLength(0)
    expect(readDemoFeedMessages('feed-runtime')).toHaveLength(beforeSendCount + 1)
    expect(
      getScenarioSnapshot(harness.getScenario()).items.at(-1)
        ?.message?.body,
    ).toBe('flaky optimistic send')
    expect(retrySent?.body).toBe('flaky optimistic send')
    expect(retrySent?.id).not.toBe(failedId)
    expect(
      getScenarioSnapshot(harness.getScenario()).segmentMeta.modifier.type,
    ).toBe('append')

    await harness.unmount()
  })

  it('treats a top-aligned retry success as send-style latest rebuild', async () => {
    const random = vi.spyOn(Math, 'random')
    random
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
    const harness = createScenarioHarness()

    await harness.render()
    await waitFor(() => {
      const scenario = harness.getScenario()
      return Boolean(scenario && !scenario.feedLoading && scenario.loadedMessageCount > 0)
    })

    await act(async () => {
      expect(harness.getScenario()?.sendMessage('top aligned retry')).toBe(true)
    })

    const failedId = getScenarioSnapshot(harness.getScenario())
      .items.at(-1)?.message?.id

    expect(failedId).toBeTruthy()
    await waitFor(() =>
      getScenarioSnapshot(harness.getScenario()).items
        .find((item) => item.message?.id === failedId)
        ?.message?.sendStatus === 'failed'
    )

    const failedMessage = readDemoFeedMessages('feed-runtime')
      .find((message) => message.id === failedId)
    expect(failedMessage).toBeTruthy()

    await act(async () => {
      harness.getScenario()?.activeSession.rows.resetAround({
        target: { id: failedId as string },
        rows: [failedMessage as NonNullable<typeof failedMessage>],
        hasMoreBefore: true,
        hasMoreAfter: false,
        anchor: { id: failedId as string },
        align: 'start',
      })
    })

    await act(async () => {
      expect(harness.getScenario()?.retryFailedSend(failedId)).toBe(true)
    })

    await waitFor(() =>
      getScenarioSnapshot(harness.getScenario()).segmentMeta
        .shortSegmentAlignment === 'start'
    )
    await waitFor(() =>
      getScenarioSnapshot(harness.getScenario()).items.some((item) =>
        item.message?.body === 'top aligned retry' &&
        item.message?.sendStatus === 'sent'
      )
    )

    const snapshot = getScenarioSnapshot(harness.getScenario())
    expect(snapshot?.segmentMeta.modifier).toEqual({ type: 'reset-latest' })
    expect(snapshot?.segmentMeta.context).toBe('latest')
    expect(
      snapshot?.items.some((item) => item.message?.id === failedId),
    ).toBe(false)

    await harness.unmount()
  })
})

function getScenarioSnapshot(scenario: DemoMessageScenario | null | undefined) {
  if (!scenario) {
    throw new Error('scenario is not ready')
  }

  return getMessageListSessionInternals(scenario.activeSession).getSnapshot()
}

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

function createScenarioHarness(): {
  host: HTMLElement
  getScenario: () => DemoMessageScenario | null
  render: () => Promise<void>
  unmount: () => Promise<void>
} {
  const host = document.createElement('div')
  const root = createRoot(host)
  let scenario: DemoMessageScenario | null = null

  function Harness() {
    const nextScenario = useDemoMessageScenario()
    scenario = nextScenario

    return (
      <MessageList
        session={nextScenario.activeSession}
        className={[
          'message-viewport',
          nextScenario.feedLoading ? 'session-loading' : '',
        ].filter(Boolean).join(' ')}
        renderRow={({ row }) => <span>{row?.id}</span>}
        renderBeforeStatus={() =>
          nextScenario.loadingBefore ? (
            <div data-testid="before-loading" />
          ) : null
        }
        renderAfterStatus={() =>
          nextScenario.loadingAfter ? (
            <div data-testid="after-loading" />
          ) : null
        }
        renderOverlayStatus={({ status }) =>
          status === 'loading' ? (
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
