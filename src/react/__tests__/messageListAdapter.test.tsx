import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type ViewportAnchorChangedEvent,
  type ViewportObservationChangedEvent,
} from '../../runtime'
import { MessageList } from '../MessageList'

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
    }))

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
