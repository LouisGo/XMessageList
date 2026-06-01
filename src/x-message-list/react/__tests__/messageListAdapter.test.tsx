import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createMessageListManager,
  type MessageListAdapter,
  type MessageListPage,
  type MessageListSession,
} from '../../core/manager/index'
import { getMessageListSessionInternals } from '../../core/manager/internal'
import type {
  MessageDataItem,
  MessageListRuntime,
  ViewportAnchorChangedEvent,
  ViewportObservationChangedEvent,
} from '../../core/runtime/index'
import { MessageList } from '../components/MessageList'
import type { OverlayStatusInput } from '../types'

describe('MessageList React adapter', () => {
  it('projects fixed DOM skeleton, rows, slots, and commit ack', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          renderBeforeStatus={() => <div data-testid="before-slot" />}
          renderAfterStatus={() => <div data-testid="after-slot" />}
          renderScrollToLatest={({ scrollToLatest }) => (
            <button type="button" onClick={scrollToLatest}>Latest</button>
          )}
          renderOverlayStatus={() => <div data-testid="overlay" />}
        />,
      )
    })

    expect(host.querySelector('[data-message-list]')).not.toBeNull()
    expect(host.querySelector('[data-message-scroll-container]')).not.toBeNull()
    expect(host.querySelector('[data-message-flow]')).not.toBeNull()
    expect(host.querySelector('[data-edge-trigger="before"]')).not.toBeNull()
    expect(host.querySelector('[data-edge-trigger="after"]')).not.toBeNull()
    expect(host.querySelector('[data-bottom-marker]')).not.toBeNull()
    expect(host.querySelectorAll('[data-message-row]')).toHaveLength(2)
    expect(host.querySelector('[data-runtime-key="row-1"]')).toMatchObject({
      textContent: 'row-1',
    })
    expect(host.querySelector('[data-spacer-height]')).toBeNull()
    expect(host.querySelector('[data-testid="before-slot"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="after-slot"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="overlay"]')).not.toBeNull()
    expect(host.querySelector('[data-message-list-overlay-layer]')).not.toBeNull()
    expect(host.querySelector('[data-message-scroll-container]')?.contains(
      host.querySelector('[data-testid="overlay"]'),
    )).toBe(false)
    expect(fixture.runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(fixture.runtime.getDiagnostics().map((record) => record.name))
      .toContain('transaction.settle')

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('uses session command for scroll-to-latest slot', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
      hasMoreAfter: true,
    })
    const events: string[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    fixture.runtime.subscribeRuntimeEvent((event) => {
      events.push(event.type)
    })

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          renderScrollToLatest={({ scrollToLatest }) => (
            <button type="button" onClick={scrollToLatest}>Latest</button>
          )}
        />,
      )
    })

    await act(async () => {
      host.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    expect(events).toContain('needLatestMessages')

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('hides scroll-to-latest slot while follow-bottom is pending', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
      hasMoreAfter: true,
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          renderScrollToLatest={({ visible, scrollToLatest }) =>
            visible ? (
              <button type="button" onClick={scrollToLatest}>Latest</button>
            ) : null
          }
        />,
      )
    })

    expect(host.querySelector('button')).not.toBeNull()

    await act(async () => {
      host.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    expect(fixture.runtime.getSnapshot().pendingIntent).toBe('follow-bottom')
    expect(host.querySelector('button')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('refreshes scroll-to-latest distance from viewport observations', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          renderScrollToLatest={({ distanceToBottom }) =>
            distanceToBottom > 100 ? (
              <button type="button">Latest</button>
            ) : null
          }
        />,
      )
    })

    const container = host.querySelector<HTMLElement>('[data-message-scroll-container]')
    expect(container).not.toBeNull()

    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 100,
    })
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 500,
    })

    await act(async () => {
      container!.scrollTop = 350
      container!.dispatchEvent(new Event('scroll'))
      await waitForAnimationFrame()
    })
    expect(host.querySelector('button')).toBeNull()

    await act(async () => {
      container!.scrollTop = 200
      container!.dispatchEvent(new Event('scroll'))
      await waitForAnimationFrame()
    })
    expect(host.querySelector('button')).not.toBeNull()

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('forwards viewport anchor and observation events to public callbacks', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
    })
    const anchorEvents: ViewportAnchorChangedEvent[] = []
    const observationEvents: ViewportObservationChangedEvent[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          onViewportAnchorChange={(event) => anchorEvents.push(event)}
          onViewportObservationChange={(event) => {
            observationEvents.push(event)
          }}
        />,
      )
    })

    expect(anchorEvents).toContainEqual(expect.objectContaining({
      reason: 'transaction-settle',
      anchor: expect.objectContaining({ stableId: 'row-1' }),
    }))
    expect(observationEvents).toContainEqual(expect.objectContaining({
      visibleKeys: ['row-1'],
      visibleItems: [expect.objectContaining({
        key: 'row-1',
        visibleRatio: 1,
      })],
    }))

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('passes manager overlay status into overlay slot', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
    })
    const overlayInputs: OverlayStatusInput[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          renderOverlayStatus={(input) => {
            overlayInputs.push(input)
            return <div data-testid="overlay">{input.status}</div>
          }}
        />,
      )
    })

    expect(overlayInputs.at(-1)?.status).toBe('idle')

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('uses public session command for scroll-to-message', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
    })
    const events: unknown[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    fixture.runtime.subscribeRuntimeEvent((event) => events.push(event))

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
        />,
      )
    })

    await act(async () => {
      fixture.session.commands.scrollToMessage({ id: 'row-9' })
    })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMessagesAround',
      target: expect.objectContaining({
        feedId: 'feed-a',
        stableId: 'row-9',
        serverId: 'row-9',
      }),
    }))

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('uses getRowRenderVersion for scoped row rerenders', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const versions = new Map([
      ['row-1', 0],
      ['row-2', 0],
    ])
    const renderCounts = new Map<string, number>()
    const createRenderRow = () => ({ item: nextItem }: {
      item: MessageDataItem<string>
    }) => {
      renderCounts.set(nextItem.key, (renderCounts.get(nextItem.key) ?? 0) + 1)
      return <span>{versions.get(nextItem.key)}</span>
    }

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={createRenderRow()}
          getRowRenderVersion={(nextItem) => versions.get(nextItem.key)}
        />,
      )
    })
    versions.set('row-2', 1)
    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={createRenderRow()}
          getRowRenderVersion={(nextItem) => versions.get(nextItem.key)}
        />,
      )
    })

    expect(renderCounts.get('row-1')).toBe(1)
    expect(renderCounts.get('row-2')).toBe(2)

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('rerenders rows when renderRow captures external state without explicit row versions', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const renderCounts = new Map<string, number>()
    let highlightedRow = 'row-1'
    const render = () => (
      <MessageList
        session={fixture.session}
        renderRow={({ row }) => {
          renderCounts.set(row, (renderCounts.get(row) ?? 0) + 1)
          return (
            <span data-testid={`row-${row}`}>
              {highlightedRow === row ? 'highlighted' : 'normal'}
            </span>
          )
        }}
      />
    )

    await act(async () => {
      root.render(render())
    })

    highlightedRow = 'row-2'
    await act(async () => {
      root.render(render())
    })

    expect(host.querySelector('[data-testid="row-row-1"]')?.textContent)
      .toBe('normal')
    expect(host.querySelector('[data-testid="row-row-2"]')?.textContent)
      .toBe('highlighted')
    expect(renderCounts.get('row-1')).toBe(2)
    expect(renderCounts.get('row-2')).toBe(2)

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('keeps StrictMode double commit ack idempotent', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <StrictMode>
          <MessageList
            session={fixture.session}
            renderRow={({ row }) => <span>{row}</span>}
          />
        </StrictMode>,
      )
    })

    expect(fixture.runtime.getDiagnostics().map((record) => record.name))
      .not.toContain('transaction.staleCommitAck')

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('detaches previous session runtime before attaching a switched session', async () => {
    const fixtureA = createSessionFixture({
      feedId: 'feed-a',
      rows: ['row-a'],
    })
    const fixtureB = createSessionFixture({
      feedId: 'feed-b',
      rows: ['row-b'],
    })
    const anchorEvents: ViewportAnchorChangedEvent[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    fixtureA.runtime.subscribeRuntimeEvent((event) => {
      if (event.type === 'viewportAnchorChanged') {
        anchorEvents.push(event)
      }
    })

    await act(async () => {
      root.render(
        <MessageList
          session={fixtureA.session}
          renderRow={({ row }) => <span>{row}</span>}
        />,
      )
    })

    await act(async () => {
      root.render(
        <MessageList
          session={fixtureB.session}
          renderRow={({ row }) => <span>{row}</span>}
        />,
      )
    })

    expect(anchorEvents).toContainEqual(expect.objectContaining({
      reason: 'detach',
      anchor: expect.objectContaining({ stableId: 'row-a' }),
    }))
    expect(fixtureB.runtime.getSnapshot().viewportPhase).toBe('IDLE')

    await act(async () => {
      root.unmount()
    })
    fixtureA.destroy()
    fixtureB.destroy()
  })

  it('renders custom scrollbar overlay from native metrics', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          scrollbar="custom"
        />,
      )
    })

    const container = host.querySelector<HTMLElement>('[data-message-scroll-container]')
    const track = host.querySelector<HTMLElement>('[data-message-scrollbar-track]')

    expect(host.querySelector('[data-message-scrollbar-overlay]')).not.toBeNull()
    expect(container).not.toBeNull()
    expect(track).not.toBeNull()

    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 100,
    })
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 300,
    })
    track!.getBoundingClientRect = () => ({
      top: 0,
      bottom: 100,
      left: 0,
      right: 12,
      width: 12,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect

    await act(async () => {
      container!.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })
    await act(async () => {
      track!.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        clientY: 80,
      }))
    })

    expect(container!.scrollTop).toBeGreaterThan(0)
    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('keeps custom scrollbar observers and listeners stable across projection revisions', async () => {
    const installedObservers = installCountingObservers()
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <MessageList
            session={fixture.session}
            renderRow={({ row }) => <span>{row}</span>}
            scrollbar="custom"
          />,
        )
      })

      const container = host.querySelector<HTMLElement>('[data-message-scroll-container]')
      expect(container).not.toBeNull()
      await act(async () => {
        await waitForAnimationFrame()
      })

      const addEventListener = vi.spyOn(container!, 'addEventListener')
      const removeEventListener = vi.spyOn(container!, 'removeEventListener')

      await act(async () => {
        fixture.session.rows.patch(['row-1', 'row-2', 'row-3'])
        await waitForAnimationFrame()
      })

      expect(installedObservers.counters.resizeConstructed).toBe(1)
      expect(installedObservers.counters.mutationConstructed).toBe(1)
      expect(installedObservers.counters.resizeDisconnected).toBe(0)
      expect(installedObservers.counters.mutationDisconnected).toBe(0)
      expect(addEventListener).not.toHaveBeenCalled()
      expect(removeEventListener).not.toHaveBeenCalled()

      addEventListener.mockRestore()
      removeEventListener.mockRestore()
    } finally {
      await act(async () => {
        root.unmount()
      })
      fixture.destroy()
      installedObservers.restore()
    }
  })

  it('schedules custom scrollbar projection refresh without synchronous metric reads', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const getEvidence = vi.spyOn(fixture.runtime, 'getEvidence')

    try {
      await act(async () => {
        root.render(
          <MessageList
            session={fixture.session}
            renderRow={({ row }) => <span>{row}</span>}
            scrollbar="custom"
          />,
        )
      })

      const container = host.querySelector<HTMLElement>('[data-message-scroll-container]')
      expect(container).not.toBeNull()

      Object.defineProperty(container, 'clientHeight', {
        configurable: true,
        value: 100,
      })
      Object.defineProperty(container, 'scrollHeight', {
        configurable: true,
        value: 300,
      })

      await act(async () => {
        await waitForAnimationFrame()
      })
      getEvidence.mockClear()

      Object.defineProperty(container, 'scrollHeight', {
        configurable: true,
        value: 500,
      })
      await act(async () => {
        fixture.session.rows.patch(['row-1', 'row-2', 'row-3'])
      })

      expect(getEvidence).not.toHaveBeenCalled()

      await act(async () => {
        await waitForAnimationFrame()
      })

      expect(getEvidence).toHaveBeenCalled()
    } finally {
      getEvidence.mockRestore()
      await act(async () => {
        root.unmount()
      })
      fixture.destroy()
    }
  })

  it('rebases an active custom scrollbar drag after native range changes', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          scrollbar="custom"
        />,
      )
    })

    const container = host.querySelector<HTMLElement>('[data-message-scroll-container]')
    const track = host.querySelector<HTMLElement>('[data-message-scrollbar-track]')
    const thumb = host.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')

    expect(container).not.toBeNull()
    expect(track).not.toBeNull()
    expect(thumb).not.toBeNull()

    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 100,
    })
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 300,
    })
    track!.getBoundingClientRect = () => ({
      top: 0,
      bottom: 100,
      left: 0,
      right: 12,
      width: 12,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect

    await act(async () => {
      container!.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })
    await act(async () => {
      thumb!.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        clientY: 0,
      }))
      thumb!.dispatchEvent(new MouseEvent('pointermove', {
        bubbles: true,
        clientY: 60,
      }))
    })

    expect(container!.scrollTop).toBeGreaterThan(170)

    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 500,
    })
    await act(async () => {
      fixture.session.rows.patch(['row-1', 'row-2'])
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })
    await act(async () => {
      thumb!.dispatchEvent(new MouseEvent('pointermove', {
        bubbles: true,
        clientY: 78,
      }))
    })

    expect(container!.scrollTop).toBeGreaterThan(260)
    expect(fixture.runtime.getDiagnostics().map((record) => record.name))
      .toContain('directScroll.rebased')

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })
})

function createSessionFixture(input: {
  feedId?: string
  rows: string[]
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
}): {
  session: MessageListSession<string>
  runtime: MessageListRuntime<string>
  destroy: () => void
} {
  const feedId = input.feedId ?? 'feed-a'
  const manager = createMessageListManager<string>({
    getAdapter: () => createStringAdapter(input.rows, {
      hasMoreBefore: input.hasMoreBefore,
      hasMoreAfter: input.hasMoreAfter,
      feedId,
    }),
  })
  const session = manager.getSession(feedId)
  const runtime = getMessageListSessionInternals(session).runtime

  session.rows.resetLatest(page(input.rows, {
    hasMoreBefore: input.hasMoreBefore,
    hasMoreAfter: input.hasMoreAfter,
    feedId,
  }))

  return {
    session,
    runtime,
    destroy: () => manager.destroyAll(),
  }
}

function createStringAdapter(
  latestRows: string[],
  pageOptions: Parameters<typeof page>[1] = {},
): MessageListAdapter<string> {
  return {
    row: {
      getKey: (row) => row,
      getAnchor: (row) => ({ id: row }),
    },
    request: {
      loadLatest: () => Promise.resolve(page(latestRows, pageOptions)),
      loadBefore: () => Promise.resolve(page([])),
      loadAfter: () => Promise.resolve(page([])),
      loadAround: () => Promise.resolve(page(latestRows)),
    },
  }
}

function page(
  rows: string[],
  overrides: Partial<MessageListPage<string>> & { feedId?: string } = {},
): MessageListPage<string> {
  return {
    rows,
    hasMoreBefore: overrides.hasMoreBefore ?? false,
    hasMoreAfter: overrides.hasMoreAfter ?? false,
    anchor: rows.at(-1)
      ? { id: rows.at(-1), feedId: overrides.feedId }
      : undefined,
    anchorStatus: overrides.anchorStatus,
    total: overrides.total,
  }
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

function installCountingObservers(): {
  counters: {
    resizeConstructed: number
    resizeDisconnected: number
    mutationConstructed: number
    mutationDisconnected: number
  }
  restore: () => void
} {
  const previousResizeObserver = globalThis.ResizeObserver
  const previousMutationObserver = globalThis.MutationObserver
  const counters = {
    resizeConstructed: 0,
    resizeDisconnected: 0,
    mutationConstructed: 0,
    mutationDisconnected: 0,
  }

  class CountingResizeObserver implements ResizeObserver {
    constructor() {
      counters.resizeConstructed += 1
    }

    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      counters.resizeDisconnected += 1
    }
  }

  class CountingMutationObserver implements MutationObserver {
    constructor() {
      counters.mutationConstructed += 1
    }

    observe(): void {}
    disconnect(): void {
      counters.mutationDisconnected += 1
    }
    takeRecords(): MutationRecord[] {
      return []
    }
  }

  replaceGlobal('ResizeObserver', CountingResizeObserver)
  replaceGlobal('MutationObserver', CountingMutationObserver)

  return {
    counters,
    restore: () => {
      replaceGlobal('ResizeObserver', previousResizeObserver)
      replaceGlobal('MutationObserver', previousMutationObserver)
    },
  }
}

function replaceGlobal(
  name: 'ResizeObserver' | 'MutationObserver',
  value: unknown,
): void {
  if (typeof value === 'undefined') {
    delete (globalThis as Record<string, unknown>)[name]
    return
  }

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  })
}
