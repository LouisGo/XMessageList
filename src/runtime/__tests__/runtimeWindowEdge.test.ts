import { describe, expect, it } from 'vitest'
import {
  createContainer,
  createSnapshot,
  createRuntime,
  mountProjection,
  flushBootstrap,
  flushFramesWithMicrotasks,
  flushMotion,
  flushTransactionTimeout,
  flushScrollFrames,
  markUserScrollIntent,
} from './runtimeTestUtils'
import type { MessageViewportRuntimeEvent } from '..'

describe('MessageViewportRuntime window and edge', () => {
  it('sizes latest bootstrap window from viewport overscan and mounted floor', async () => {
    const { runtime } = createRuntime({
      window: {
        maxMountedItems: 40,
      },
    })
    const container = createContainer({ height: 600 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.endIndex).toBe(59)
    expect(snapshot.renderWindow.itemKeys).toHaveLength(40)
    expect(snapshot.renderWindow.itemKeys.length).toBeGreaterThan(20)
  })

  it('keeps the internal mounted floor bounded by maxMountedItems at the data tail', async () => {
    const { runtime } = createRuntime({
      window: {
        maxMountedItems: 10,
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({
        count: 30,
        revision: 1,
        effect: 'reset',
        estimatedHeight: 400,
      }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.startIndex).toBe(20)
    expect(snapshot.renderWindow.endIndex).toBe(29)
    expect(snapshot.renderWindow.itemKeys).toHaveLength(10)
  })

  it('recomputes follow-bottom with the viewport-aware latest window', async () => {
    const { runtime, scheduler } = createRuntime({
      window: {
        maxMountedItems: 40,
      },
    })
    const container = createContainer({ height: 600 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({
      type: 'jump',
      origin: { messageId: 'm-60', position: 60 },
      target: { messageId: 'm-10', position: 10 },
    })
    await Promise.resolve()
    let snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    runtime.dispatch({ type: 'followBottom' })
    await flushFramesWithMicrotasks(scheduler, 2)

    snapshot = runtime.getSnapshot()
    expect(['PROJECTING', 'MOTION_ACTIVE']).toContain(snapshot.viewportPhase)
    expect(snapshot.renderWindow.endIndex).toBe(59)
    expect(snapshot.renderWindow.itemKeys).toHaveLength(40)
  })

  it('keeps anchor visual top during prepend transaction', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset', start: 20 }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    container.scrollTop = runtime.getSnapshot().topSpacer + 100
    mountProjection(runtime, container, runtime.getSnapshot(), -container.scrollTop)
    const scrollTopBeforePrepend = container.scrollTop

    runtime.setDataSnapshot(createSnapshot({ count: 35, revision: 2, effect: 'prepend', start: 15 }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, 300)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBeGreaterThan(scrollTopBeforePrepend)
  })

  it('recovers from prepend commit timeout without staying in projection phase', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset', start: 20 }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-25' } })
    await Promise.resolve()
    let snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushMotion(scheduler)
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')

    runtime.setDataSnapshot(createSnapshot({ count: 35, revision: 2, effect: 'prepend', start: 15 }))
    await Promise.resolve()
    snapshot = runtime.getSnapshot()
    expect(snapshot.viewportPhase).toBe('PROJECTING')

    await flushTransactionTimeout(scheduler)

    expect(runtime.getDebugSnapshot().state).toBe('READY')
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
  })

  it('discards stale commit ack after generation changes', async () => {
    const { runtime } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    const staleSnapshot = runtime.getSnapshot()
    runtime.setDataSnapshot({
      ...createSnapshot({ count: 10, revision: 1, effect: 'reset' }),
      feedId: 'next-feed',
      generation: 2,
    })
    runtime.notifyProjectionCommitted({
      feedId: staleSnapshot.feedId,
      generation: staleSnapshot.generation,
      revision: staleSnapshot.revision,
    })

    expect(runtime.getSnapshot().feedId).toBe('next-feed')
    expect(runtime.getDebugSnapshot().heightCacheSize).toBe(0)
  })

  it('does not request history while only approaching render overscan', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    container.scrollTop = runtime.getSnapshot().topSpacer + 10
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    await Promise.resolve()

    expect(events).not.toContain('needMoreBefore')
  })

  it('slides the render window after a fast scrollbar drag lands inside spacer-only space', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 100,
      revision: 1,
      effect: 'reset',
      hasMoreAfter: true,
    }))
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: { messageId: 'm-20' },
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    let snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.startIndex).toBeLessThan(40)

    markUserScrollIntent(container)
    container.scrollTop = 4_500
    mountProjection(runtime, container, snapshot, -container.scrollTop)
    await flushScrollFrames(container, scheduler, 1)
    snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.startIndex).toBeGreaterThan(60)
  })

  it('slides toward earlier items when a fast drag lands in top spacer-only space', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 300,
      revision: 1,
      effect: 'reset',
      hasMoreAfter: true,
    }))
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: { messageId: 'm-150' },
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    let snapshot = runtime.getSnapshot()
    const previousStart = snapshot.renderWindow.startIndex
    expect(snapshot.topSpacer).toBeGreaterThan(container.clientHeight * 2)

    markUserScrollIntent(container)
    container.scrollTop = snapshot.topSpacer - container.clientHeight
    mountProjection(runtime, container, snapshot, -container.scrollTop)
    expect(runtime.getViewportAnchorState()).toBeNull()
    await flushScrollFrames(container, scheduler, 1)

    snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.startIndex).toBeLessThan(previousStart)
  })

  it('does not request history from sentinel intersection before user edge intent', async () => {
    const { runtime, scheduler, observers } = createRuntime()
    const container = createContainer({ height: 900 })
    const events: string[] = []
    const topSentinel = document.createElement('div')

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.registerTopSentinel(topSentinel)
    runtime.setDataSnapshot(createSnapshot({ count: 9, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    observers.intersectionObservers[0]?.trigger(topSentinel, true)

    expect(events).not.toContain('needMoreBefore')
  })

  it('does not request history from cached reattach without fresh user edge intent', async () => {
    const { runtime, scheduler, observers } = createRuntime()
    const container = createContainer({ height: 300 })
    const topSentinel = document.createElement('div')
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.registerTopSentinel(topSentinel)
    runtime.setDataSnapshot(createSnapshot({ count: 10, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    markUserScrollIntent(container)
    container.scrollTop = 400
    await flushScrollFrames(container, scheduler, 1)
    events.length = 0

    container.scrollTop = 0
    runtime.detach()
    runtime.attach(container)
    runtime.registerTopSentinel(topSentinel)

    const latestObserver =
      observers.intersectionObservers[observers.intersectionObservers.length - 1]

    latestObserver?.trigger(topSentinel, true)
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    await Promise.resolve()

    expect(events).not.toContain('needMoreBefore')

    markUserScrollIntent(container)
    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)

    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(1)
  })

  it('does not request history from follow-bottom scroll on an underfilled list', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 900 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 9, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({ type: 'followBottom' })
    await Promise.resolve()
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushFramesWithMicrotasks(scheduler, 3)

    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    await Promise.resolve()

    expect(events).not.toContain('needMoreBefore')
  })

  it('does not enter bottom lock at the bottom of a partial data window', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({
        count: 30,
        revision: 1,
        effect: 'reset',
        hasMoreAfter: true,
      }),
    )
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: { messageId: 'm-30' },
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    await flushScrollFrames(container, scheduler, 3)

    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
  })

  it('does not follow bottom for append pages while newer data still exists', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({
        count: 30,
        revision: 1,
        effect: 'reset',
        hasMoreAfter: true,
      }),
    )
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: { messageId: 'm-30' },
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    const scrollTopBeforeAppend = container.scrollTop

    runtime.setDataSnapshot(
      createSnapshot({
        count: 50,
        revision: 2,
        effect: 'append',
        hasMoreAfter: true,
      }),
    )
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushFramesWithMicrotasks(scheduler, 2)

    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(container.scrollTop).toBe(scrollTopBeforeAppend)
  })

  it('reconciles a stale unlocked state when append starts from the physical bottom', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 20, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    markUserScrollIntent(container)
    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')

    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    runtime.setDataSnapshot(createSnapshot({ count: 21, revision: 2, effect: 'append' }))
    await Promise.resolve()
    let snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushMotion(scheduler)
    snapshot = runtime.getSnapshot()

    expect(snapshot.bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(
      Math.max(0, container.scrollHeight - container.clientHeight),
    )
  })

  it('turns follow-bottom on a partial data window into a latest-window request', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({
        count: 30,
        revision: 1,
        effect: 'reset',
        hasMoreAfter: true,
      }),
    )
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: { messageId: 'm-30' },
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({ type: 'followBottom' })
    await Promise.resolve()

    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'needLatestMessages',
        reason: 'bottom-follow',
      }),
    )
  })

})
