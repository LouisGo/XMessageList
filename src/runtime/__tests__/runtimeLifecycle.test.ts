import { describe, expect, it } from 'vitest'
import {
  createContainer,
  createSnapshot,
  createRuntime,
  mountProjection,
  flushBootstrap,
  flushFramesWithMicrotasks,
  flushTransactionTimeout,
  getExpectedRestoreScrollTop,
} from './runtimeTestUtils'
import type { MessageViewportRuntimeEvent } from '..'

describe('MessageViewportRuntime lifecycle', () => {
  it('keeps snapshot reference stable when projection does not change', () => {
    const { runtime } = createRuntime()
    const first = runtime.getSnapshot()
    const second = runtime.getSnapshot()

    expect(second).toBe(first)
  })

  it('keeps diagnostics silent by default', () => {
    const { runtime } = createRuntime()
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.dispatch({ type: 'followBottom' })

    expect(runtime.getDiagnosticRecords()).toEqual([])
    expect(events.some((event) => event.type === 'viewportDiagnostic')).toBe(false)
  })

  it('stores diagnostic records without emitting events when configured', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['motion'],
          emitEvents: false,
          maxEntries: 10,
        },
      },
    })
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
    await Promise.resolve()

    const records = runtime.getDiagnosticRecords()
    const pendingRecord = records.find(
      (record) => record.name === 'followBottom.pending',
    )

    expect(pendingRecord).toEqual(
      expect.objectContaining({
        channel: 'motion',
        severity: 'info',
        correlationId: expect.stringMatching(/^command:follow-bottom-/),
        details: expect.objectContaining({
          itemCount: 30,
          hasMoreAfter: true,
        }),
      }),
    )
    expect(events.some((event) => event.type === 'viewportDiagnostic')).toBe(false)
  })

  it('bootstraps latest data into bottom locked state', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const snapshot = runtime.getSnapshot()
    expect(snapshot.bootstrapState).toBe('READY')
    expect(snapshot.bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBeGreaterThan(0)
  })

  it('exports the current viewport anchor state', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, -(snapshot.topSpacer + 135))

    expect(runtime.getViewportAnchorState()).toEqual({
      key: snapshot.items[2]?.key ?? { kind: 'committed', messageId: '' },
      offsetWithinMessage: 35,
    })
  })

  it('emits a detach viewport anchor checkpoint before clearing DOM refs', async () => {
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

    const snapshot = runtime.getSnapshot()

    mountProjection(runtime, container, snapshot, -(snapshot.topSpacer + 135))
    const anchorBeforeDetach = runtime.getViewportAnchorState()

    events.length = 0
    runtime.detach()

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'viewportAnchorChanged',
        feedId: 'feed',
        generation: 1,
        reason: 'detach',
        anchor: anchorBeforeDetach,
      }),
    )
    expect(anchorBeforeDetach).not.toBeNull()
    expect(runtime.getViewportAnchorState()).toBeNull()
  })

  it('ignores non-bootstrap commands until the runtime is ready', () => {
    const { runtime } = createRuntime()
    const before = runtime.getDebugSnapshot()

    runtime.dispatch({ type: 'followBottom' })
    runtime.dispatch({
      type: 'jump',
      origin: { messageId: 'm-60', position: 60 },
      target: { messageId: 'm-10', position: 10 },
    })
    runtime.dispatch({ type: 'restore', target: { messageId: 'm-10' } })

    expect(runtime.getDebugSnapshot()).toEqual(before)
  })

  it('bootstraps restored data using top plus offset alignment', async () => {
    const { runtime } = createRuntime()
    const container = createContainer({ height: 300 })
    const restoreTarget = {
      key: { kind: 'committed' as const, messageId: 'm-20' },
      offsetWithinMessage: 18,
    }

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 40, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'restored', target: restoreTarget })
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

    expect(runtime.getSnapshot().bootstrapState).toBe('READY')
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(container.scrollTop).toBe(
      getExpectedRestoreScrollTop(snapshot, 'm-20', 18),
    )
  })

  it('locks bottom when restored bootstrap settles at the physical latest bottom', async () => {
    const { runtime } = createRuntime()
    const container = createContainer({ height: 300 })
    const restoreTarget = {
      key: { kind: 'committed' as const, messageId: 'm-5' },
      offsetWithinMessage: 0,
    }

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 10, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'restored', target: restoreTarget })
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

    expect(container.scrollTop).toBe(200)
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
  })

  it('recomputes the latest window on container height resize and keeps bottom lock', async () => {
    const { runtime, scheduler, observers } = createRuntime({
      window: {
        maxMountedItems: 60,
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 80, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const beforeLength = runtime.getSnapshot().renderWindow.itemKeys.length
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 800,
    })

    observers.resizeObservers.at(-1)?.trigger(container, 800)
    await Promise.resolve()
    scheduler.flushFrame()
    await Promise.resolve()

    const resizedSnapshot = runtime.getSnapshot()
    expect(resizedSnapshot.renderWindow.itemKeys.length).toBeGreaterThan(beforeLength)
    expect(resizedSnapshot.bottomLockState).toBe('LOCKED')

    mountProjection(runtime, container, resizedSnapshot)
    runtime.notifyProjectionCommitted({
      feedId: resizedSnapshot.feedId,
      generation: resizedSnapshot.generation,
      revision: resizedSnapshot.revision,
    })
    await flushFramesWithMicrotasks(scheduler, 2)

    expect(runtime.getDebugSnapshot().state).toBe('READY')
  })

  it('recovers from bootstrap commit timeout and allows retry', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()

    expect(runtime.getSnapshot().bootstrapState).toBe('MOUNTING')

    await flushTransactionTimeout(scheduler)

    expect(runtime.getDebugSnapshot().state).toBe('ATTACHED')
    expect(runtime.getSnapshot().bootstrapState).toBe('INITIAL')
    expect(runtime.getSnapshot().items).toHaveLength(0)

    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const snapshot = runtime.getSnapshot()
    expect(snapshot.bootstrapState).toBe('READY')
    expect(snapshot.bottomLockState).toBe('LOCKED')
  })

  it('does not measure projection before matching commit ack', async () => {
    const { runtime } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().heightCacheSize).toBe(0)

    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision + 1,
    })
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().heightCacheSize).toBe(0)
  })

})
