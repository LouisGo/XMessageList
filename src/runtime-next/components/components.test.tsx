import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageViewportRuntime } from '../MessageViewportRuntime'
import { RuntimeNextMessageViewport } from './MessageViewport'
import { RuntimeNextCustomScrollbar } from './CustomScrollbar'
import { computeRuntimeNextScrollbarGeometry } from './scrollbarGeometry'
import type { MessageDataItem, PhysicalScrollMetrics, RuntimeListener } from '../types'

function item(messageId: string, estimatedHeight = 96): MessageDataItem<{ text: string }> {
  return {
    kind: 'committed',
    key: {
      kind: 'committed',
      messageId,
    },
    message: {
      text: messageId,
    },
    version: 1,
    estimatedHeight,
  }
}

function snapshot(input: {
  readonly items: readonly MessageDataItem<{ text: string }>[]
  readonly revision?: number
}) {
  return {
    feedId: 'feed',
    generation: 1,
    revision: input.revision ?? 1,
    items: input.items,
    hasMoreBefore: false,
    hasMoreAfter: true,
    change: {
      kind: 'initial' as const,
      viewportModifier: 'none' as const,
    },
  }
}

describe('runtime-next React adapter', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('acks projection with the full commit token from layout effect', async () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const notify = vi.spyOn(runtime, 'notifyProjectionCommitted')
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <RuntimeNextMessageViewport
          runtime={runtime}
          renderMessage={(message) =>
            message.kind === 'committed' ? message.message.text : null}
          style={{ height: 240 }}
        />,
      )
    })
    await act(async () => {
      runtime.setDataSnapshot(snapshot({
        items: [item('m-1'), item('m-2')],
      }))
      runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    })

    expect(notify).toHaveBeenLastCalledWith(runtime.getSnapshot().commitToken)
    expect(runtime.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(
      runtime.getSnapshot().commitToken.segmentRevision,
    )
    expect(host.querySelector('[data-natural-blank]')).not.toBeNull()

    await act(async () => root.unmount())
  })

  it('keeps row projection from rerendering on physical metrics updates', async () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    let renderCount = 0

    await act(async () => {
      root.render(
        <RuntimeNextMessageViewport
          runtime={runtime}
          renderMessage={(message) => {
            renderCount += 1
            return message.kind === 'committed' ? message.message.text : null
          }}
          style={{ height: 240 }}
        />,
      )
    })
    await act(async () => {
      runtime.setDataSnapshot(snapshot({
        items: Array.from({ length: 8 }, (_, index) =>
          item(`m-${index + 1}`, 300)),
      }))
      runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    })
    const renderCountAfterCommit = renderCount

    await act(async () => {
      runtime.writeDirectScrollTop(120, { source: 'custom-scrollbar-track' })
    })

    expect(renderCount).toBe(renderCountAfterCommit)
    expect(
      host.querySelector('[data-testid="runtime-next-custom-scrollbar-thumb"]'),
    ).not.toBeNull()

    await act(async () => root.unmount())
  })

  it('derives scrollbar geometry from physical metrics only', () => {
    const geometry = computeRuntimeNextScrollbarGeometry({
      physicalSegmentId: 'segment',
      physicalSegmentRevision: 1,
      viewportSize: 200,
      physicalWindowSize: 1000,
      domScrollHeight: 333,
      scrollPosition: 400,
      maxScrollPosition: 800,
      scrollHeightCap: 1000,
      capMode: 'normal',
      safeScrollRangeStart: 0,
      safeScrollRangeEnd: 800,
      isDragLocked: false,
      isThumbFrozen: false,
      isSegmentShiftPending: false,
      pendingShiftDirection: null,
      pendingEdgeOverflowPx: 0,
      isSegmentShifting: false,
      isMomentumLatched: false,
      suppressedMomentumDeltaPx: 0,
      segmentRelayoutState: 'idle',
      segmentRelayoutReason: null,
      adjacentPrefetchBefore: 'idle',
      adjacentPrefetchAfter: 'idle',
    })

    expect(geometry.thumbLength).toBe(38.4)
    expect(geometry.thumbTop).toBeGreaterThan(0)
  })

  it('resets custom scrollbar drag baseline after metrics change', async () => {
    const listeners = new Set<RuntimeListener>()
    let metrics = metricsSnapshot({ scrollPosition: 0 })
    const runtime = {
      getPhysicalScrollMetrics: () => metrics,
      subscribePhysicalScroll: (listener: RuntimeListener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      beginDirectScroll: vi.fn(),
      writeDirectScrollTop: vi.fn(),
      endDirectScroll: vi.fn(),
    } as unknown as MessageViewportRuntime
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(<RuntimeNextCustomScrollbar runtime={runtime} />)
    })

    const track = host.querySelector<HTMLElement>(
      '[data-testid="runtime-next-custom-scrollbar"]',
    )
    const thumb = host.querySelector<HTMLElement>(
      '[data-testid="runtime-next-custom-scrollbar-thumb"]',
    )
    expect(track).not.toBeNull()
    expect(thumb).not.toBeNull()
    track!.getBoundingClientRect = () => rect({ height: 200 })
    const initialGeometry = computeRuntimeNextScrollbarGeometry(metrics)

    await act(async () => {
      thumb!.dispatchEvent(pointerEvent('pointerdown', {
        clientY: initialGeometry.thumbTop + 5,
        pointerId: 1,
      }))
    })

    metrics = metricsSnapshot({ scrollPosition: 400 })
    await act(async () => {
      for (const listener of listeners) listener()
    })
    await act(async () => {
      document.dispatchEvent(pointerEvent('pointermove', {
        clientY: initialGeometry.thumbTop + 15,
        pointerId: 1,
      }))
    })

    const lastWrite =
      vi.mocked(runtime.writeDirectScrollTop).mock.calls.at(-1)?.[0]
    expect(lastWrite).toBeGreaterThan(400)

    await act(async () => root.unmount())
  })
})

function metricsSnapshot(input: {
  readonly scrollPosition: number
  readonly frozen?: boolean
}): PhysicalScrollMetrics {
  return {
    physicalSegmentId: 'segment',
    physicalSegmentRevision: input.scrollPosition,
    viewportSize: 200,
    physicalWindowSize: 1000,
    domScrollHeight: 1000,
    scrollPosition: input.scrollPosition,
    maxScrollPosition: 800,
    scrollHeightCap: 1000,
    capMode: 'normal',
    safeScrollRangeStart: 0,
    safeScrollRangeEnd: 800,
    isDragLocked: true,
    isThumbFrozen: input.frozen ?? false,
    isSegmentShiftPending: false,
    pendingShiftDirection: null,
    pendingEdgeOverflowPx: 0,
    isSegmentShifting: false,
    isMomentumLatched: false,
    suppressedMomentumDeltaPx: 0,
    segmentRelayoutState: 'idle',
    segmentRelayoutReason: null,
    adjacentPrefetchBefore: 'idle',
    adjacentPrefetchAfter: 'idle',
  }
}

function rect(input: { readonly height: number }): DOMRect {
  return {
    top: 0,
    bottom: input.height,
    left: 0,
    right: 10,
    width: 10,
    height: input.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

function pointerEvent(
  type: string,
  input: { readonly clientY: number; readonly pointerId: number },
): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent
  Object.defineProperties(event, {
    clientY: { value: input.clientY },
    pointerId: { value: input.pointerId },
  })
  return event
}
