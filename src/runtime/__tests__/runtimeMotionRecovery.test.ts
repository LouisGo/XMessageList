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
  setElementMetrics,
} from './runtimeTestUtils'
import type { MessageViewportRuntimeEvent } from '..'

describe('MessageViewportRuntime motion and recovery', () => {
  it('keeps pending follow-bottom across latest-window snapshots until latest arrives', async () => {
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

    runtime.dispatch({ type: 'followBottom' })
    expect(runtime.getDebugSnapshot().destinationState).toBe('pendingData')
    runtime.setDataSnapshot(
      createSnapshot({
        count: 40,
        revision: 2,
        effect: 'append',
        hasMoreAfter: true,
      }),
    )
    runtime.setDataSnapshot(
      createSnapshot({
        count: 50,
        revision: 3,
        effect: 'append',
        hasMoreAfter: false,
      }),
    )
    await Promise.resolve()

    expect(
      events.filter(
        (event) =>
          event.type === 'needLatestMessages' &&
          event.reason === 'bottom-follow',
      ),
    ).toHaveLength(3)
    expect(runtime.getDebugSnapshot().destinationState).toBe('pendingData')

    runtime.setDataSnapshot(
      createSnapshot({
        count: 20,
        revision: 4,
        effect: 'auto-scroll-to-bottom',
        kind: 'reset',
        hasMoreAfter: false,
        start: 31,
      }),
    )
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    expect(snapshot.viewportPhase).toBe('PROJECTING')
    expect(runtime.getDebugSnapshot().destinationState).toBe('resolvingDom')
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushMotion(scheduler)

    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
    expect(runtime.getDebugSnapshot().destinationState).toBe('settled')
  })

  it('animates follow-bottom after latest projection clamps scrollTop to the new bottom', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['motion'],
          emitEvents: false,
          maxEntries: 100,
        },
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({
        count: 80,
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
    container.scrollTop = 6000

    runtime.dispatch({ type: 'followBottom' })
    await Promise.resolve()
    runtime.setDataSnapshot(
      createSnapshot({
        count: 20,
        revision: 2,
        effect: 'auto-scroll-to-bottom',
        kind: 'reset',
        hasMoreAfter: false,
        start: 81,
      }),
    )
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    expect(snapshot.viewportPhase).toBe('PROJECTING')
    expect(runtime.getDebugSnapshot().destinationState).toBe('resolvingDom')
    mountProjection(runtime, container, snapshot)
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    const records = runtime.getDiagnosticRecords()
    expect(records).toContainEqual(
      expect.objectContaining({
        name: 'destinationMotion.start',
        details: expect.objectContaining({
          source: 'followBottom',
          forcedStartTop: 0,
        }),
      }),
    )
    expect(runtime.getDebugSnapshot().motionActive).toBe(true)

    await flushMotion(scheduler)
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
  })

  it('keeps pending follow-bottom on raw user input without scroll movement', async () => {
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

    runtime.dispatch({ type: 'followBottom' })
    container.dispatchEvent(new Event('wheel'))
    runtime.setDataSnapshot(
      createSnapshot({
        count: 40,
        revision: 2,
        effect: 'append',
        hasMoreAfter: true,
      }),
    )
    await Promise.resolve()

    expect(
      events.filter(
        (event) =>
          event.type === 'needLatestMessages' &&
          event.reason === 'bottom-follow',
      ),
    ).toHaveLength(2)
  })

  it('cancels pending follow-bottom when the user scrolls upward', async () => {
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

    container.scrollTop = 500
    runtime.dispatch({ type: 'followBottom' })
    container.dispatchEvent(new Event('wheel'))
    container.scrollTop = 380
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    await Promise.resolve()

    runtime.setDataSnapshot(
      createSnapshot({
        count: 40,
        revision: 2,
        effect: 'append',
        hasMoreAfter: true,
      }),
    )
    await Promise.resolve()

    expect(
      events.filter(
        (event) =>
          event.type === 'needLatestMessages' &&
          event.reason === 'bottom-follow',
      ),
    ).toHaveLength(1)
  })

  it('uses the jump scroll source during jump motion', async () => {
    const { runtime, scheduler } = createRuntime({
      scrollMotion: { maxDistancePx: 120 },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({
      type: 'jump',
      origin: { messageId: 'm-1000', position: 1000 },
      target: { messageId: 'm-400', position: 400 },
    })
    await Promise.resolve()
    runtime.setDataSnapshot(createSnapshot({
      count: 41,
      revision: 2,
      effect: 'reset',
      start: 380,
    }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()
    scheduler.flushFrame()
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()

    expect(runtime.getDebugSnapshot().lastScrollSource).toBe('jump')
  })

  it('settles directionless jumps without starting motion', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-10' } })
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'destinationSettled',
        intent: 'jump',
        target: { messageId: 'm-10' },
        resolution: 'target',
      }),
    )
  })

  it('starts upward quote jumps from below the target', async () => {
    const { runtime, scheduler } = createRuntime({
      scrollMotion: { maxDistancePx: 120 },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({
      type: 'jump',
      origin: { messageId: 'm-1000', position: 1000 },
      target: { messageId: 'm-400', position: 400 },
    })
    await Promise.resolve()
    runtime.setDataSnapshot(createSnapshot({
      count: 41,
      revision: 2,
      effect: 'reset',
      start: 380,
    }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().motionActive).toBe(true)
    expect(container.scrollTop).toBeGreaterThan(0)
    const forcedStartTop = container.scrollTop
    await flushMotion(scheduler)

    expect(container.scrollTop).toBeLessThan(forcedStartTop)
  })

  it('cancels jump motion on user wheel and leaves the viewport unlocked', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({
      type: 'jump',
      origin: { messageId: 'm-1000', position: 1000 },
      target: { messageId: 'm-400', position: 400 },
    })
    await Promise.resolve()
    runtime.setDataSnapshot(createSnapshot({
      count: 41,
      revision: 2,
      effect: 'reset',
      start: 380,
    }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(runtime.getDebugSnapshot().motionActive).toBe(true)
    events.length = 0

    container.dispatchEvent(new Event('wheel'))

    expect(runtime.getDebugSnapshot().state).toBe('READY')
    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')

    await flushFramesWithMicrotasks(scheduler, 5)

    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getDebugSnapshot().readySubstate).toBe('READY_IDLE')
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'destinationSettled',
      }),
    )
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'needMessagesAround',
      }),
    )
  })

  it('cancels active destination motion before stabilizing a row resize', async () => {
    const { runtime, scheduler, observers } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({
      type: 'jump',
      origin: { messageId: 'm-1000', position: 1000 },
      target: { messageId: 'm-400', position: 400 },
    })
    await Promise.resolve()
    runtime.setDataSnapshot(createSnapshot({
      count: 41,
      revision: 2,
      effect: 'reset',
      start: 380,
    }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(runtime.getDebugSnapshot().motionActive).toBe(true)

    const row = container.querySelector<HTMLElement>('[data-message-row]')
    const rowResizeObserver = observers.resizeObservers[0]

    if (!row || !rowResizeObserver) {
      throw new Error('expected a mounted row and row resize observer')
    }

    rowResizeObserver.trigger(row, 80)
    const rowTop = row.getBoundingClientRect().top
    setElementMetrics(row, { top: rowTop, height: 80 })
    scheduler.flushFrame()
    await Promise.resolve()

    const stoppedScrollTop = container.scrollTop

    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')

    await flushFramesWithMicrotasks(scheduler, 3)

    expect(container.scrollTop).toBe(stoppedScrollTop)
    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
  })

  it('uses instant fallback when scroll motion is disabled', async () => {
    const { runtime, scheduler } = createRuntime({
      scrollMotion: { enabled: false },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-10' } })
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
  })

  it('recovers from follow-bottom commit timeout and can follow again', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 40, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-10' } })
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

    runtime.dispatch({ type: 'followBottom' })
    await Promise.resolve()
    snapshot = runtime.getSnapshot()
    expect(snapshot.viewportPhase).toBe('PROJECTING')
    expect(runtime.getDebugSnapshot().destinationState).toBe('resolvingDom')

    await flushTransactionTimeout(scheduler)

    expect(runtime.getDebugSnapshot().state).toBe('READY')
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')

    runtime.dispatch({ type: 'followBottom' })
    await Promise.resolve()
    snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushMotion(scheduler)

    snapshot = runtime.getSnapshot()
    expect(snapshot.bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)
  })

})
