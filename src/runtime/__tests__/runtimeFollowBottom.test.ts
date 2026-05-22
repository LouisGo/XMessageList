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
  markUserScrollIntent,
  createHeightMap,
  startFollowBottomMotionFromMiddle,
} from './runtimeTestUtils'
import type { MessageViewportRuntimeEvent } from '..'

describe('MessageViewportRuntime follow bottom', () => {
  it('follows bottom for append while locked', async () => {
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

    runtime.setDataSnapshot(createSnapshot({ count: 31, revision: 2, effect: 'append' }))
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
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)
    expect(
      events.filter(
        (event) =>
          event.type === 'viewportAnchorChanged' &&
          event.reason === 'transaction-settle',
      ),
    ).toHaveLength(1)
  })

  it('waits for latest projection before following bottom manually', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const tallLatestRows = createHeightMap(31, 40, 100)

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 40, revision: 1, effect: 'reset' }))
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
    await flushMotion(scheduler)
    snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.endIndex).toBeLessThan(39)

    runtime.dispatch({ type: 'followBottom' })
    await flushFramesWithMicrotasks(scheduler, 2)
    await Promise.resolve()
    snapshot = runtime.getSnapshot()
    expect(snapshot.viewportPhase).toBe('PROJECTING')
    mountProjection(runtime, container, snapshot, 0, tallLatestRows)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushMotion(scheduler)

    snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.endIndex).toBe(39)
    expect(snapshot.bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)
  })

  it('continues explicit follow-bottom intent after append supersedes motion', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['transaction', 'motion'],
          emitEvents: false,
          maxEntries: 100,
        },
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 80, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    await startFollowBottomMotionFromMiddle({ runtime, scheduler, container })

    runtime.setDataSnapshot(createSnapshot({ count: 81, revision: 2, effect: 'append' }))
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    expect(runtime.getDebugSnapshot().motionActive).toBe(true)

    await flushMotion(scheduler)

    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)

    const records = runtime.getDiagnosticRecords()
    expect(records).toContainEqual(
      expect.objectContaining({
        name: 'destinationMotion.cancel',
        details: expect.objectContaining({
          source: 'followBottom',
          reason: 'transaction-supersede',
          transactionKind: 'append',
          transactionId: expect.stringMatching(/^append-/),
        }),
      }),
    )
    expect(
      records.filter(
        (record) =>
          record.name === 'destinationMotion.start' &&
          record.details.source === 'followBottom',
      ).length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('continues explicit follow-bottom intent after resize refresh supersedes motion', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 80, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    await startFollowBottomMotionFromMiddle({ runtime, scheduler, container })

    runtime.setDataSnapshot(
      createSnapshot({ count: 80, revision: 2, effect: 'items-change' }),
    )
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    expect(runtime.getDebugSnapshot().motionActive).toBe(true)

    await flushMotion(scheduler)

    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)
  })

  it('keeps local send auto-scroll intent when a storm refresh supersedes its motion', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['motion', 'transaction'],
          emitEvents: false,
          maxEntries: 100,
        },
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 80, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-80' } })
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    await flushMotion(scheduler)
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')

    runtime.setDataSnapshot(
      createSnapshot({ count: 181, revision: 2, effect: 'auto-scroll-to-bottom' }),
    )
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    expect(runtime.getDebugSnapshot().motionActive).toBe(true)

    runtime.setDataSnapshot(createSnapshot({ count: 181, revision: 3, effect: 'items-change' }))
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    expect(runtime.getDebugSnapshot().motionActive).toBe(true)

    await flushMotion(scheduler)

    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)
    expect(runtime.getDiagnosticRecords()).toContainEqual(
      expect.objectContaining({
        name: 'destinationMotion.cancel',
        details: expect.objectContaining({
          reason: 'transaction-supersede',
          transactionKind: 'resize',
        }),
      }),
    )
  })

  it('recomputes latest window for locked item refresh before scrolling to bottom', async () => {
    const { runtime, scheduler } = createRuntime({
      window: {
        maxMountedItems: 20,
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 80, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const before = runtime.getSnapshot()
    expect(before.bottomLockState).toBe('LOCKED')
    expect(before.renderWindow.endIndex).toBe(79)

    runtime.setDataSnapshot(
      createSnapshot({ count: 86, revision: 2, effect: 'items-change' }),
    )
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    await flushFramesWithMicrotasks(scheduler, 2)

    const after = runtime.getSnapshot()
    expect(after.bottomLockState).toBe('LOCKED')
    expect(after.renderWindow.endIndex).toBe(85)
    expect(after.items.at(-1)?.key).toEqual({
      kind: 'committed',
      messageId: 'm-86',
    })
    expect(after.bottomSpacer).toBe(0)
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)
  })

  it('clears explicit follow-bottom intent after a real upward user scroll', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 80, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    await startFollowBottomMotionFromMiddle({ runtime, scheduler, container })

    const interruptedScrollTop = 0
    markUserScrollIntent(container)
    container.scrollTop = interruptedScrollTop
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    await Promise.resolve()

    runtime.setDataSnapshot(createSnapshot({ count: 81, revision: 2, effect: 'append' }))
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    await flushFramesWithMicrotasks(scheduler, 2)

    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(container.scrollTop).toBe(interruptedScrollTop)
    expect(container.scrollTop).not.toBe(
      container.scrollHeight - container.clientHeight,
    )
  })

})
