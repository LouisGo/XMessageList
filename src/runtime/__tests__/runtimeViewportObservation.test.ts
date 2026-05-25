import { describe, expect, it } from 'vitest'
import {
  createContainer,
  createRuntime,
  createSnapshot,
  flushBootstrap,
  flushScrollFrames,
  markUserScrollIntent,
} from './runtimeTestUtils'
import type {
  MessageViewportRuntimeEvent,
  ViewportObservationChangedEvent,
} from '..'

describe('MessageViewportRuntime viewport observations', () => {
  it('emits visible-range observations from scroll frames without repeating unchanged frames', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 120 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
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

    const settleObservation = events
      .filter(isViewportObservation)
      .find((event) => event.reason === 'transaction-settle')
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

    const scrollObservations = events.filter(isViewportObservation)
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

    const countAfterFirstFrame = events.filter(isViewportObservation).length
    await flushScrollFrames(container, scheduler, 1)

    expect(events.filter(isViewportObservation)).toHaveLength(countAfterFirstFrame)
  })

  it('emits idle and detach observations with feed and generation', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 120 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
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

    expect(events.filter(isViewportObservation)).toContainEqual(
      expect.objectContaining({
        feedId: 'feed',
        generation: 1,
        reason: 'scroll-idle',
      }),
    )

    runtime.detach()

    expect(events.filter(isViewportObservation)).toContainEqual(
      expect.objectContaining({
        feedId: 'feed',
        generation: 1,
        reason: 'detach',
      }),
    )
  })
})

function isViewportObservation(
  event: MessageViewportRuntimeEvent,
): event is ViewportObservationChangedEvent {
  return event.type === 'viewportObservationChanged'
}
