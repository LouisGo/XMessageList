import { describe, expect, it, vi } from 'vitest'
import {
  createContainer,
  createRuntime,
  createSnapshot,
  flushBootstrap,
  flushScrollFrames,
  markUserScrollIntent,
  setElementMetrics,
  type TestMessage,
} from './runtimeTestUtils'
import { DomRegistry } from '../dom/domRegistry'
import type { ProjectionStore } from '../core/state/projectionStore'
import { RuntimeViewportObservationEvents } from '../core/controller/runtimeViewportObservationEvents'
import type { ViewportObservationChangedEvent } from '..'

describe('MessageViewportRuntime viewport observations', () => {
  it('emits visible-range observations from scroll frames without repeating unchanged frames', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 120 })
    const events: ViewportObservationChangedEvent[] = []

    runtime.subscribeViewportObservation((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({
        count: 8,
        revision: 1,
        effect: 'reset',
        hasMoreBefore: false,
      }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const settleObservation = events.find(
      (event) => event.reason === 'transaction-settle',
    )
    expect(settleObservation).toEqual(
      expect.objectContaining({
        feedId: 'feed',
        generation: 1,
      }),
    )

    events.length = 0
    markUserScrollIntent(container)
    container.scrollTop += 25
    await flushScrollFrames(container, scheduler, 1)

    const scrollObservations = events
    const scrollObservation = scrollObservations.at(-1)

    expect(scrollObservation).toEqual(
      expect.objectContaining({
        type: 'viewportObservationChanged',
        feedId: 'feed',
        generation: 1,
        reason: 'scroll-frame',
        scrollSource: 'user',
        direction: 'down',
        activity: {
          phase: 'scrolling',
          direction: 'down',
        },
      }),
    )
    expect(scrollObservation?.visibleRange.firstKey).toEqual({
      kind: 'committed',
      messageId: 'm-1',
    })
    expect(scrollObservation?.visibleItems[0]).toEqual(
      expect.objectContaining({
        key: { kind: 'committed', messageId: 'm-1' },
        visibleRatio: expect.any(Number),
      }),
    )
    expect(scrollObservation).not.toHaveProperty('scrollTop')

    const countAfterFirstFrame = events.length
    await flushScrollFrames(container, scheduler, 1)

    expect(events).toHaveLength(countAfterFirstFrame)
  })

  it('emits idle and detach observations with feed and generation', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 120 })
    const events: ViewportObservationChangedEvent[] = []

    runtime.subscribeViewportObservation((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({
        count: 8,
        revision: 1,
        effect: 'reset',
        hasMoreBefore: false,
      }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    markUserScrollIntent(container)
    container.scrollTop = 25
    await flushScrollFrames(container, scheduler, 1)
    scheduler.flushTimers()
    await Promise.resolve()

    expect(events).toContainEqual(
      expect.objectContaining({
        feedId: 'feed',
        generation: 1,
        reason: 'scroll-idle',
      }),
    )

    runtime.detach()

    expect(events).toContainEqual(
      expect.objectContaining({
        feedId: 'feed',
        generation: 1,
        reason: 'detach',
      }),
    )
  })

  it('does not measure visibility without viewport observation subscribers', () => {
    const registry = new DomRegistry()
    const container = createContainer({ height: 120 })
    const row = document.createElement('div')
    const data = createSnapshot({
      count: 1,
      revision: 1,
      effect: 'reset',
      hasMoreBefore: false,
    })
    const firstItem = data.items[0]

    if (!firstItem) {
      throw new Error('expected test snapshot item')
    }

    const snapshot = {
      feedId: data.feedId,
      generation: data.generation,
      revision: 1,
      items: data.items,
      renderWindow: {
        startIndex: 0,
        endIndex: 0,
        itemKeys: [firstItem.key],
      },
      topSpacer: 0,
      bottomSpacer: 0,
      bottomLockState: 'LOCKED' as const,
      bootstrapState: 'READY' as const,
      viewportPhase: 'IDLE' as const,
      edgeState: {
        before: 'idle' as const,
        after: 'idle' as const,
      },
    }
    const emitViewportObservation = vi.fn()

    registry.attachContainer(container)
    setElementMetrics(row, { top: 0, height: 48 })
    registry.registerRow(firstItem.key, row)
    const containerRectSpy = vi.spyOn(container, 'getBoundingClientRect')
    const rowRectSpy = vi.spyOn(row, 'getBoundingClientRect')
    const observationEvents = new RuntimeViewportObservationEvents({
      registry,
      store: {
        getSnapshot: () => snapshot,
      } as ProjectionStore<TestMessage, unknown>,
      getDataSnapshot: () => data,
      getLastScrollSource: () => 'user',
      captureViewportAnchor: () => null,
      hasViewportObservationListeners: () => false,
      emitViewportObservation,
    })

    observationEvents.emitChanged('scroll-frame', 'user')

    expect(containerRectSpy).not.toHaveBeenCalled()
    expect(rowRectSpy).not.toHaveBeenCalled()
    expect(emitViewportObservation).not.toHaveBeenCalled()
  })

  it('resets observation signatures when the last subscriber unsubscribes', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 120 })
    const firstSubscriptionEvents: ViewportObservationChangedEvent[] = []
    const secondSubscriptionEvents: ViewportObservationChangedEvent[] = []

    const unsubscribe = runtime.subscribeViewportObservation((event) => {
      firstSubscriptionEvents.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({
        count: 8,
        revision: 1,
        effect: 'reset',
        hasMoreBefore: false,
      }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    firstSubscriptionEvents.length = 0
    markUserScrollIntent(container)
    container.scrollTop += 25
    await flushScrollFrames(container, scheduler, 1)
    expect(firstSubscriptionEvents).toContainEqual(
      expect.objectContaining({ reason: 'scroll-frame' }),
    )

    unsubscribe()
    runtime.subscribeViewportObservation((event) => {
      secondSubscriptionEvents.push(event)
    })
    await flushScrollFrames(container, scheduler, 1)

    expect(secondSubscriptionEvents).toContainEqual(
      expect.objectContaining({ reason: 'scroll-frame' }),
    )
  })
})
