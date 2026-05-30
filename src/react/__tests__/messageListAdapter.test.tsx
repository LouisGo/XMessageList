import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type MessageListRuntimeEvent,
  type ViewportAnchorChangedEvent,
  type ViewportObservationChangedEvent,
} from '../../runtime/index'
import { MessageList } from '../components/MessageList'
import type { MessageListOverlayInput } from '../types'

describe('MessageList React adapter', () => {
  it('projects fixed DOM skeleton, rows, slots, and commit ack', async () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const host = document.createElement('div')
    const root = createRoot(host)

    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')]))

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtime}
          renderRow={(nextItem) => <span>{nextItem.message}</span>}
          renderBeforeEdge={() => <div data-testid="before-slot" />}
          renderAfterEdge={() => <div data-testid="after-slot" />}
          renderScrollToLatest={({ scrollToLatest }) => (
            <button type="button" onClick={scrollToLatest}>Latest</button>
          )}
          renderOverlay={() => <div data-testid="overlay" />}
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
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'transaction.settle',
    )

    await act(async () => {
      root.unmount()
    })
  })

  it('uses runtime semantic command for scroll-to-latest slot', async () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const events: string[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    runtime.subscribeRuntimeEvent((event) => {
      events.push(event.type)
    })
    runtime.applyLoadedSegment(segment([item('row-1')], {
      hasMoreAfter: true,
    }))

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtime}
          renderRow={(nextItem) => <span>{nextItem.message}</span>}
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
  })

  it('forwards viewport anchor and observation events to public callbacks', async () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const anchorEvents: ViewportAnchorChangedEvent[] = []
    const observationEvents: ViewportObservationChangedEvent[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    runtime.applyLoadedSegment(segment([item('row-1')], {
      anchor: {
        feedId: 'feed-a',
        stableId: 'row-1',
        serverId: 'row-1',
      },
    }))

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtime}
          renderRow={(nextItem) => <span>{nextItem.message}</span>}
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
  })

  it('passes observation and limited commands into overlay', async () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const events: MessageListRuntimeEvent[] = []
    const overlayInputs: MessageListOverlayInput[] = []
    const host = document.createElement('div')
    const root = createRoot(host)
    const target = { feedId: 'feed-a', stableId: 'row-9', serverId: 'row-9' }

    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')]))

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtime}
          renderRow={(nextItem) => <span>{nextItem.message}</span>}
          renderOverlay={(input) => {
            overlayInputs.push(input)
            return <button type="button" onClick={() => input.commands.scrollToMessage(target)} />
          }}
        />,
      )
    })

    const latestInput = overlayInputs.at(-1)
    expect(latestInput?.observation).toEqual(expect.objectContaining({
      visibleKeys: ['row-1'],
    }))
    expect(Object.keys(latestInput?.commands ?? {}).sort()).toEqual([
      'scrollToLatest',
      'scrollToMessage',
    ])

    await act(async () => {
      host.querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMessagesAround',
      target,
    }))

    await act(async () => {
      root.unmount()
    })
  })

  it('uses getRowRenderVersion for scoped row rerenders', async () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const host = document.createElement('div')
    const root = createRoot(host)
    const versions = new Map([
      ['row-1', 0],
      ['row-2', 0],
    ])
    const renderCounts = new Map<string, number>()
    const createRenderRow = () => (nextItem: MessageDataItem<string>) => {
      renderCounts.set(nextItem.key, (renderCounts.get(nextItem.key) ?? 0) + 1)
      return <span>{versions.get(nextItem.key)}</span>
    }

    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')]))

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtime}
          renderRow={createRenderRow()}
          getRowRenderVersion={(nextItem) => versions.get(nextItem.key)}
        />,
      )
    })
    versions.set('row-2', 1)
    await act(async () => {
      root.render(
        <MessageList
          runtime={runtime}
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
  })

  it('keeps StrictMode double commit ack idempotent', async () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const host = document.createElement('div')
    const root = createRoot(host)

    runtime.applyLoadedSegment(segment([item('row-1')]))

    await act(async () => {
      root.render(
        <StrictMode>
          <MessageList
            runtime={runtime}
            renderRow={(nextItem) => <span>{nextItem.message}</span>}
          />
        </StrictMode>,
      )
    })

    expect(runtime.getDiagnostics().map((record) => record.name)).not.toContain(
      'transaction.staleCommitAck',
    )

    await act(async () => {
      root.unmount()
    })
  })

  it('detaches previous runtime before attaching a switched feed runtime', async () => {
    const runtimeA = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const runtimeB = createMessageListRuntime<string>({ feedId: 'feed-b' })
    const anchorEvents: ViewportAnchorChangedEvent[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    runtimeA.subscribeRuntimeEvent((event) => {
      if (event.type === 'viewportAnchorChanged') {
        anchorEvents.push(event)
      }
    })
    runtimeA.applyLoadedSegment(segment([item('row-a')], {
      anchor: {
        feedId: 'feed-a',
        stableId: 'row-a',
        serverId: 'row-a',
      },
    }))
    runtimeB.applyLoadedSegment(segment([item('row-b', 'feed-b')], {
      feedId: 'feed-b',
    }))

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtimeA}
          renderRow={(nextItem) => <span>{nextItem.message}</span>}
        />,
      )
    })

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtimeB}
          renderRow={(nextItem) => <span>{nextItem.message}</span>}
        />,
      )
    })

    expect(anchorEvents).toContainEqual(expect.objectContaining({
      reason: 'detach',
      anchor: expect.objectContaining({ stableId: 'row-a' }),
    }))
    expect(runtimeB.getSnapshot().viewportPhase).toBe('IDLE')

    await act(async () => {
      root.unmount()
    })
  })

  it('renders custom scrollbar overlay from native metrics', async () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const host = document.createElement('div')
    const root = createRoot(host)

    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')]))

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtime}
          renderRow={(nextItem) => <span>{nextItem.message}</span>}
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
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'overlay.metricMismatch',
    )

    await act(async () => {
      root.unmount()
    })
  })

  it('rebases an active custom scrollbar drag after native range changes', async () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const host = document.createElement('div')
    const root = createRoot(host)

    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')]))

    await act(async () => {
      root.render(
        <MessageList
          runtime={runtime}
          renderRow={(nextItem) => <span>{nextItem.message}</span>}
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
      runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], {
        segmentRevision: 2,
        modifier: { type: 'patch', changedKeys: ['row-1'] },
      }))
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })
    await act(async () => {
      thumb!.dispatchEvent(new MouseEvent('pointermove', {
        bubbles: true,
        clientY: 78,
      }))
    })

    expect(container!.scrollTop).toBeGreaterThan(260)
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'directScroll.rebased',
    )

    await act(async () => {
      root.unmount()
    })
  })
})

function item(key: string, feedId = 'feed-a'): MessageDataItem<string> {
  return {
    key,
    rowKind: 'message',
    renderVersion: 1,
    message: key,
    identity: {
      feedId,
      stableId: key,
      serverId: key,
      version: 1,
    },
  }
}

function segment(
  items: MessageDataItem<string>[],
  overrides: Partial<LoadedSegment<string>> = {},
): LoadedSegment<string> {
  return {
    feedId: 'feed-a',
    generation: 1,
    segmentRevision: 1,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'bootstrap' },
    ...overrides,
  }
}
