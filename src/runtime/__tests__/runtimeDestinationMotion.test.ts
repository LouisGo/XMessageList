import { describe, expect, it } from 'vitest'
import {
  createContainer,
  createSnapshot,
  createRuntime,
  mountProjection,
  flushBootstrap,
  commitCurrentProjection,
  flushFramesWithMicrotasks,
  flushMotion,
  flushScrollFrames,
  markUserScrollIntent,
  getExpectedRestoreScrollTop,
} from './runtimeTestUtils'
import type { MessageViewportRuntimeEvent } from '..'

describe('MessageViewportRuntime destination motion', () => {
  it('re-resolves jump destination when a data transaction supersedes motion', async () => {
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
    await commitCurrentProjection(runtime, container)
    events.length = 0

    expect(runtime.getDebugSnapshot().motionActive).toBe(true)
    expect(runtime.getDebugSnapshot().destinationState).toBe('motionActive')

    runtime.setDataSnapshot(createSnapshot({
      count: 41,
      revision: 3,
      effect: 'items-change',
      start: 380,
    }))
    await Promise.resolve()

    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'destinationSettled',
      }),
    )
    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')

    await commitCurrentProjection(runtime, container)
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    await flushMotion(scheduler)

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'destinationSettled',
        intent: 'jump',
        target: { messageId: 'm-400', position: 400 },
        resolution: 'target',
      }),
    )
    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getDebugSnapshot().destinationState).toBe('settled')
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
  })

  it('jumps to the resolved anchor when a missing jump target was deleted', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 1,
      effect: 'reset',
      start: 31,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({
      type: 'jump',
      origin: { messageId: 'm-32', position: 32 },
      target: { messageId: 'm-17', position: 17 },
    })
    await Promise.resolve()

    const aroundSnapshot = createSnapshot({
      count: 42,
      revision: 2,
      effect: 'reset',
      start: 1,
    })
    runtime.setDataSnapshot({
      ...aroundSnapshot,
      items: aroundSnapshot.items.filter(
        (item) => item.key.kind !== 'committed' || item.key.messageId !== 'm-17',
      ),
      anchor: { messageId: 'm-14', position: 14 },
      anchorStatus: 'deleted',
    })
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushMotion(scheduler)

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'destinationSettled',
        intent: 'jump',
        target: { messageId: 'm-17', position: 17 },
        resolution: 'fallback-deleted',
        resolvedTarget: { messageId: 'm-14', position: 14 },
      }),
    )
    expect(events.some((event) =>
      event.type === 'viewportError' && event.code === 'jump-target-missing',
    )).toBe(false)
  })

  it('emits a viewportAnchorChanged event after scroll idle', async () => {
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

    markUserScrollIntent(container)
    container.scrollTop = 100
    await flushScrollFrames(container, scheduler, 4)
    scheduler.flushTimers()
    await Promise.resolve()

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'viewportAnchorChanged',
        reason: 'scroll-idle',
      }),
    )
  })

  it('does not emit edge paging requests after bootstrap commit timeout', async () => {
    const { runtime, scheduler, observers } = createRuntime()
    const container = createContainer({ height: 300 })
    const topSentinel = document.createElement('div')
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.registerTopSentinel(topSentinel)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: { messageId: 'm-10' },
    })
    await Promise.resolve()

    scheduler.flushTimers()
    await Promise.resolve()
    observers.intersectionObservers[0]?.trigger(topSentinel, true)

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'viewportError',
        code: 'commit-timeout-bootstrap',
      }),
    )
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'needMoreBefore',
      }),
    )
  })

  it('restores to top plus offset instead of centering the target row', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const restoreTarget = {
      key: { kind: 'committed' as const, messageId: 'm-10' },
      offsetWithinMessage: 24,
    }

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 40, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({ type: 'restore', target: restoreTarget })
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    expect(snapshot.viewportPhase).toBe('PROJECTING')

    mountProjection(runtime, container, snapshot, -container.scrollTop)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(container.scrollTop).toBe(
      getExpectedRestoreScrollTop(snapshot, 'm-10', 24),
    )
  })

  it('requests an around-target window before restoring a missing target', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []
    const restoreTarget = {
      key: { kind: 'committed' as const, messageId: 'm-5000' },
      offsetWithinMessage: 18,
    }

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({ type: 'restore', target: restoreTarget })
    await Promise.resolve()

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'needMessagesAround',
        reason: 'restore',
        target: { messageId: 'm-5000' },
      }),
    )
    expect(events.some((event) => event.type === 'viewportError')).toBe(false)

    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 2,
      effect: 'reset',
      start: 4986,
    }))
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, -container.scrollTop)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBe(
      getExpectedRestoreScrollTop(snapshot, 'm-5000', 18),
    )
    expect(runtime.getDebugSnapshot().readySubstate).toBe('READY_IDLE')
  })

  it('restores to the resolved anchor when a missing restore target was deleted', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []
    const restoreTarget = {
      key: { kind: 'committed' as const, messageId: 'm-17' },
      offsetWithinMessage: 18,
    }

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 1,
      effect: 'reset',
      start: 31,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({ type: 'restore', target: restoreTarget })
    await Promise.resolve()

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'needMessagesAround',
        reason: 'restore',
        target: { messageId: 'm-17' },
      }),
    )

    const aroundSnapshot = createSnapshot({
      count: 42,
      revision: 2,
      effect: 'reset',
      start: 1,
    })
    runtime.setDataSnapshot({
      ...aroundSnapshot,
      items: aroundSnapshot.items.filter(
        (item) => item.key.kind !== 'committed' || item.key.messageId !== 'm-17',
      ),
      anchor: { messageId: 'm-14', position: 14 },
      anchorStatus: 'deleted',
    })
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, -container.scrollTop)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBe(
      getExpectedRestoreScrollTop(snapshot, 'm-14', 0),
    )
    expect(runtime.getDebugSnapshot().readySubstate).toBe('READY_IDLE')
    expect(runtime.getDebugSnapshot().destinationState).toBe('settled')
    expect(events.some((event) =>
      event.type === 'viewportError' && event.code === 'restore-target-missing',
    )).toBe(false)
  })

  it('falls back to a nearest measurable row when the restore target DOM is missing', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []
    const restoreTarget = {
      key: { kind: 'committed' as const, messageId: 'm-10' },
      offsetWithinMessage: 24,
    }

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 40, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({ type: 'restore', target: restoreTarget })
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, -container.scrollTop)
    runtime.registerRow({ kind: 'committed', messageId: 'm-10' }, null)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushFramesWithMicrotasks(scheduler, 3)

    expect(runtime.getDebugSnapshot().state).toBe('READY')
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'viewportError',
        code: 'restore-target-dom-missing-fallback',
      }),
    )
  })

})
