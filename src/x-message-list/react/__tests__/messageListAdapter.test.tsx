import { StrictMode, act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createMessageListSessionRegistry,
  type MessageListAdapter,
  type MessageListPage,
  type MessageListSession,
} from '../../core/session-registry/index'
import { getMessageListSessionInternals } from '../../core/session-registry/internal'
import type {
  MessageDataItem,
  MessageListSnapshot,
  MessageListRuntime,
  ViewportAnchorChangedEvent,
  ViewportObservationChangedEvent,
} from '../../core/runtime/index'
import {
  getMessageListAdapterRuntime,
  type MessageListAdapterRuntime,
} from '../../core/runtime/internal'
import { MessageFlow } from '../components/MessageFlow'
import { MessageList } from '../components/MessageList'
import { useMessageListState } from '../hooks/useMessageListState'
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
    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer?.contains(
      host.querySelector('[data-testid="overlay"]'),
    )).toBe(false)
    expect(scrollContainer?.contains(
      host.querySelector('button'),
    )).toBe(false)
    expect(host.querySelector('[data-message-list-affordance-layer]'))
      .not.toBeNull()
    expect(scrollContainer?.style.overflowY).toBe('auto')
    expect(scrollContainer?.style.overflowAnchor).toBe('none')
    expect(host.querySelector<HTMLElement>('[data-message-flow]')?.style.display)
      .toBe('flex')
    expect(fixture.runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(fixture.runtime.getDiagnostics().map((record) => record.name))
      .toContain('transaction.settle')

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('renders the top placeholder only after the loaded segment reaches history start', async () => {
    const runtime = createFlowRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageFlow
          runtime={runtime}
          snapshot={createFlowSnapshot({ hasMoreBefore: true })}
          renderRow={({ row }) => <span>{row}</span>}
          renderTopPlaceholder={() => <div data-testid="top-placeholder" />}
          reload={() => undefined}
          usesRowRenderVersion={false}
        />,
      )
    })

    expect(host.querySelector('[data-message-top-placeholder]')).toBeNull()

    await act(async () => {
      root.render(
        <MessageFlow
          runtime={runtime}
          snapshot={createFlowSnapshot({ hasMoreBefore: false })}
          renderRow={({ row }) => <span>{row}</span>}
          renderTopPlaceholder={() => <div data-testid="top-placeholder" />}
          reload={() => undefined}
          usesRowRenderVersion={false}
        />,
      )
    })

    const top = host.querySelector('[data-message-top-placeholder]')
    const firstRow = host.querySelector('[data-runtime-key="row-1"]')

    expect(top).not.toBeNull()
    expect(top?.compareDocumentPosition(firstRow as Node))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await act(async () => {
      root.unmount()
    })
  })

  it('uses session command for scroll-to-latest slot', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const scrollToLatest = vi.spyOn(fixture.session.commands, 'scrollToLatest')

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
      fixture.session.rows.resetAround({
        ...page(['row-1'], { hasMoreAfter: true }),
        target: { id: 'row-1' },
      })
      await waitForAnimationFrame()
    })

    await act(async () => {
      host.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    expect(scrollToLatest).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('passes loaded context into the scroll-to-latest slot', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const loadedContexts: string[] = []

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          renderScrollToLatest={({ visibleByScroll, loadedContext, scrollToLatest }) => {
            loadedContexts.push(loadedContext)
            return loadedContext !== 'latest' || visibleByScroll ? (
              <button type="button" onClick={scrollToLatest}>Latest</button>
            ) : null
          }}
        />,
      )
    })
    await act(async () => {
      fixture.session.rows.resetAround({
        ...page(['row-1'], { hasMoreAfter: true }),
        target: { id: 'row-1' },
      })
      await waitForAnimationFrame()
    })

    expect(host.querySelector('button')).not.toBeNull()
    expect(loadedContexts).toContain('around')

    await act(async () => {
      host.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
      await waitForAnimationFrame()
    })

    expect(loadedContexts).toContain('latest')
    expect(host.querySelector('button')).toBeNull()

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('updates scroll-to-latest only when scroll visibility crosses its distance threshold', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const renderScrollToLatest = vi.fn(({ visibleByScroll }) =>
      visibleByScroll ? (
        <button type="button">Latest</button>
      ) : null
    )

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          renderScrollToLatest={renderScrollToLatest}
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
    const belowThresholdRenderCount = renderScrollToLatest.mock.calls.length

    await act(async () => {
      container!.scrollTop = 340
      container!.dispatchEvent(new Event('scroll'))
      await waitForAnimationFrame()
    })
    expect(host.querySelector('button')).toBeNull()
    expect(renderScrollToLatest)
      .toHaveBeenCalledTimes(belowThresholdRenderCount)

    await act(async () => {
      container!.scrollTop = 100
      container!.dispatchEvent(new Event('scroll'))
      await waitForAnimationFrame()
    })
    expect(host.querySelector('button')).not.toBeNull()
    expect(renderScrollToLatest)
      .toHaveBeenCalledTimes(belowThresholdRenderCount + 1)

    await act(async () => {
      container!.scrollTop = 250
      container!.dispatchEvent(new Event('scroll'))
      await waitForAnimationFrame()
    })
    expect(host.querySelector('button')).toBeNull()
    expect(renderScrollToLatest)
      .toHaveBeenCalledTimes(belowThresholdRenderCount + 2)

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('lets the latest affordance decide final visibility from internal state', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1'],
      hasMoreAfter: true,
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    let setUnreadCount: ((count: number) => void) | null = null

    function LatestButton(input: {
      visibleByScroll: boolean
      scrollToLatest: () => void
    }) {
      const [unreadCount, setUnread] = useState(0)
      setUnreadCount = setUnread

      if (!input.visibleByScroll && unreadCount === 0) {
        return null
      }

      return (
        <button type="button" onClick={input.scrollToLatest}>
          {unreadCount > 0 ? `Unread ${unreadCount}` : 'Latest'}
        </button>
      )
    }

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => <span>{row}</span>}
          renderScrollToLatest={(input) => (
            <LatestButton
              visibleByScroll={input.visibleByScroll}
              scrollToLatest={input.scrollToLatest}
            />
          )}
        />,
      )
    })

    await act(async () => {
      host.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(host.querySelector('button')).toBeNull()

    await act(async () => {
      setUnreadCount?.(3)
    })
    expect(host.querySelector('button')?.textContent).toBe('Unread 3')

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
        sessionId: 'source-a',
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

  it('keeps row rerenders scoped for mutate patch, remove, and invalidate', async () => {
    const fixture = createSessionFixture({
      rows: ['row-10', 'row-11', 'row-12', 'row-13', 'row-14'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const renderCounts = new Map<string, number>()

    await act(async () => {
      root.render(
        <MessageList
          session={fixture.session}
          renderRow={({ row }) => {
            renderCounts.set(row, (renderCounts.get(row) ?? 0) + 1)
            return <span>{row}</span>
          }}
        />,
      )
    })
    const previousItems = fixture.runtime.getSnapshot().items
    renderCounts.clear()

    await act(async () => {
      fixture.session.rows.mutate({
        patches: ['row-13-edited'],
        removeKeys: ['row-13'],
        invalidateKeys: ['row-14'],
      })
      await waitForAnimationFrame()
    })

    expect(host.querySelector('[data-runtime-key="row-13"]')).toBeNull()
    expect(host.querySelector('[data-runtime-key="row-13-edited"]')).toBeNull()
    expect(renderCounts.get('row-10') ?? 0).toBe(0)
    expect(renderCounts.get('row-11') ?? 0).toBe(0)
    expect(renderCounts.get('row-12') ?? 0).toBe(0)
    expect(renderCounts.get('row-14')).toBe(1)
    expect(fixture.runtime.getSnapshot().items[0]).toBe(previousItems[0])
    expect(fixture.runtime.getSnapshot().items[1]).toBe(previousItems[1])
    expect(fixture.runtime.getSnapshot().items[2]).toBe(previousItems[2])
    expect(fixture.runtime.getSnapshot().items[3]).not.toBe(previousItems[4])
    expect(fixture.runtime.getSnapshot().segmentMeta.modifier).toMatchObject({
      type: 'remove',
      changedKeys: ['row-14'],
      removedKeys: ['row-13'],
      firstAffectedIndex: 3,
    })

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })

  it('selects session state without rerendering unchanged selections', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const renderCounts = {
      loaded: 0,
      beforeStatus: 0,
    }

    function LoadedCount() {
      const count = useMessageListState(
        fixture.session,
        (state) => state.loaded.keys.length,
      )
      renderCounts.loaded += 1
      return <span data-testid="loaded-count">{count}</span>
    }

    function BeforeStatus() {
      const status = useMessageListState(
        fixture.session,
        (state) => state.edge.before.status,
      )
      renderCounts.beforeStatus += 1
      return <span data-testid="before-status">{status}</span>
    }

    await act(async () => {
      root.render(
        <>
          <LoadedCount />
          <BeforeStatus />
        </>,
      )
    })
    ackRuntimeCommit(fixture.runtime)

    const loadedRenders = renderCounts.loaded
    const beforeStatusRenders = renderCounts.beforeStatus

    await act(async () => {
      fixture.session.rows.mutate({ invalidateKeys: ['row-2'] })
      ackRuntimeCommit(fixture.runtime)
      await waitForAnimationFrame()
    })

    expect(renderCounts.loaded).toBe(loadedRenders)
    expect(renderCounts.beforeStatus).toBe(beforeStatusRenders)

    await act(async () => {
      fixture.session.rows.mutate({ removeKeys: ['row-2'] })
      await waitForAnimationFrame()
    })

    expect(host.querySelector('[data-testid="loaded-count"]')?.textContent)
      .toBe('1')
    expect(renderCounts.loaded).toBe(loadedRenders + 1)
    expect(renderCounts.beforeStatus).toBe(beforeStatusRenders)

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
      sessionId: 'source-a',
      rows: ['row-a'],
    })
    const fixtureB = createSessionFixture({
      sessionId: 'source-b',
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
    const thumb = host.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')

    expect(host.querySelector('[data-message-scrollbar-overlay]')).not.toBeNull()
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
    expect(host.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')?.style.transform)
      .toBe('translate3d(0, 4px, 0)')

    await act(async () => {
      container!.scrollTop = 100
      container!.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })
    expect(host.querySelector<HTMLElement>('[data-message-scrollbar-thumb]')?.style.transform)
      .toBe('translate3d(0, 34px, 0)')

    await act(async () => {
      thumb!.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        clientY: 34,
      }))
    })
    expect(thumb!.style.transform).toBe('translate3d(0, 34px, 0)')

    await act(async () => {
      thumb!.dispatchEvent(new MouseEvent('pointermove', {
        bubbles: true,
        clientY: 64,
      }))
    })
    expect(thumb!.style.transform).toBe('translate3d(0, 64px, 0)')

    await act(async () => {
      thumb!.dispatchEvent(new MouseEvent('pointerup', {
        bubbles: true,
        clientY: 64,
      }))
    })
    expect(thumb!.style.transform).toBe('translate3d(0, 64px, 0)')

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

  it('batches custom scrollbar refresh diagnostics per animation frame', async () => {
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const reportOverlayDiagnostic = vi.spyOn(
      getMessageListAdapterRuntime(fixture.runtime),
      'reportOverlayDiagnostic',
    )

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
      reportOverlayDiagnostic.mockClear()

      await act(async () => {
        container!.dispatchEvent(new Event('scroll'))
        container!.dispatchEvent(new Event('scroll'))
      })
      expect(reportOverlayDiagnostic).not.toHaveBeenCalledWith(
        'overlay.refresh.count',
        expect.anything(),
      )

      await act(async () => {
        await waitForAnimationFrame()
      })

      expect(reportOverlayDiagnostic.mock.calls.filter(([name]) =>
        name === 'overlay.refresh.count'
      )).toHaveLength(1)
    } finally {
      reportOverlayDiagnostic.mockRestore()
      await act(async () => {
        root.unmount()
      })
      fixture.destroy()
    }
  })

  it('batches custom scrollbar mutation diagnostics per animation frame', async () => {
    const installedMutationObserver = installControllableMutationObserver()
    const fixture = createSessionFixture({
      rows: ['row-1', 'row-2'],
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const reportOverlayDiagnostic = vi.spyOn(
      getMessageListAdapterRuntime(fixture.runtime),
      'reportOverlayDiagnostic',
    )

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
      await act(async () => {
        await waitForAnimationFrame()
      })
      reportOverlayDiagnostic.mockClear()

      await act(async () => {
        installedMutationObserver.instances[0]?.trigger(2)
        installedMutationObserver.instances[0]?.trigger(3)
      })
      expect(reportOverlayDiagnostic).not.toHaveBeenCalledWith(
        'overlay.mutation.batch',
        expect.anything(),
      )

      await act(async () => {
        await waitForAnimationFrame()
      })

      expect(reportOverlayDiagnostic.mock.calls.filter(([name]) =>
        name === 'overlay.mutation.batch'
      )).toEqual([
        ['overlay.mutation.batch', { records: 5 }],
      ])
    } finally {
      reportOverlayDiagnostic.mockRestore()
      await act(async () => {
        root.unmount()
      })
      fixture.destroy()
      installedMutationObserver.restore()
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
    expect(fixture.runtime.getDiagnostics().map((record) => record.name))
      .toContain('overlay.drag.rebase.count')

    await act(async () => {
      root.unmount()
    })
    fixture.destroy()
  })
})

function createSessionFixture(input: {
  sessionId?: string
  rows: string[]
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
}): {
  session: MessageListSession<string>
  runtime: MessageListRuntime<string>
  destroy: () => void
} {
  const sessionId = input.sessionId ?? 'source-a'
  const registry = createMessageListSessionRegistry<string>({
    getAdapter: () => createStringAdapter(input.rows, {
      hasMoreBefore: input.hasMoreBefore,
      hasMoreAfter: false,
      sessionId,
    }),
  })
  const session = registry.getSession(sessionId)
  const sessionInternals = getMessageListSessionInternals(session)
  const releaseBootstrapRetain = sessionInternals.retainView()
  releaseBootstrapRetain()
  const runtime = sessionInternals.runtime

  const fixturePage = page(input.rows, {
    hasMoreBefore: input.hasMoreBefore,
    hasMoreAfter: input.hasMoreAfter,
    sessionId,
  })

  if (input.hasMoreAfter) {
    session.rows.resetAround({
      ...fixturePage,
      target: { id: input.rows.at(-1) ?? 'target' },
    })
  } else {
    session.rows.resetLatest(fixturePage)
  }

  return {
    session,
    runtime,
    destroy: () => registry.destroyAll(),
  }
}

function createFlowRuntime(): MessageListAdapterRuntime<string> {
  return {
    registerMessageFlowElement: vi.fn(),
    registerBeforeTriggerElement: vi.fn(),
    registerAfterTriggerElement: vi.fn(),
    registerBottomMarkerElement: vi.fn(),
    registerRowElement: vi.fn(),
    retryEdgeRequest: vi.fn(),
  } as unknown as MessageListAdapterRuntime<string>
}

function createFlowSnapshot(input: {
  hasMoreBefore: boolean
}): MessageListSnapshot<string> {
  const projectionRevision = input.hasMoreBefore ? 1 : 2
  const commitToken = {
    sessionId: 'source-a',
    generation: 1,
    segmentRevision: 1,
    projectionRevision,
  }

  return {
    ...commitToken,
    commitToken,
    items: [createFlowItem('row-1')],
    segmentMeta: {
      hasMoreBefore: input.hasMoreBefore,
      hasMoreAfter: false,
      context: 'latest',
      modifier: { type: 'reset-latest' },
      shortSegmentAlignment: 'start',
      underflow: 'settled',
    },
    edgeState: {
      before: { status: input.hasMoreBefore ? 'idle' : 'exhausted' },
      after: { status: 'idle' },
    },
    bottomLockState: 'UNLOCKED',
    pendingIntent: null,
    viewportPhase: 'IDLE',
  }
}

function createFlowItem(row: string): MessageDataItem<string> {
  return {
    key: row,
    rowKind: 'message',
    identity: {
      sessionId: 'source-a',
      stableId: row,
      version: 1,
    },
    renderVersion: 1,
    message: row,
  }
}

function ackRuntimeCommit(runtime: MessageListRuntime<string>): void {
  getMessageListAdapterRuntime(runtime)
    .ackProjectionCommit(runtime.getSnapshot().commitToken)
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
  overrides: Partial<MessageListPage<string>> & { sessionId?: string } = {},
): MessageListPage<string> {
  return {
    rows,
    hasMoreBefore: overrides.hasMoreBefore ?? false,
    hasMoreAfter: overrides.hasMoreAfter ?? false,
    anchor: rows.at(-1)
      ? { id: rows.at(-1), sessionId: overrides.sessionId }
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

function installControllableMutationObserver(): {
  instances: Array<MutationObserver & { trigger(count: number): void }>
  restore: () => void
} {
  const previousMutationObserver = globalThis.MutationObserver
  const instances: Array<MutationObserver & { trigger(count: number): void }> = []

  class ControllableMutationObserver implements MutationObserver {
    constructor(private readonly callback: MutationCallback) {
      instances.push(this)
    }

    observe(): void {}
    disconnect(): void {}
    takeRecords(): MutationRecord[] { return [] }
    trigger(count: number): void {
      this.callback(
        Array.from({ length: count }, () => ({}) as MutationRecord),
        this,
      )
    }
  }

  replaceGlobal('MutationObserver', ControllableMutationObserver)

  return {
    instances,
    restore: () => {
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
