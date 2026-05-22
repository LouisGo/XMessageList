import { describe, expect, it } from 'vitest'
import {
  createContainer,
  createSnapshot,
  createRuntime,
  mountProjection,
  flushBootstrap,
  flushMotion,
  getExpectedRestoreScrollTop,
} from './runtimeTestUtils'
import type { MessageViewportRuntimeEvent } from '..'

describe('MessageViewportRuntime destination rebuild', () => {
  it('requests an around-target window for far jump without requiring gap backfill', async () => {
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
      target: { messageId: 'm-10000', position: 10000 },
    })
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().readySubstate).toBe(
      'READY_DESTINATION_PENDING',
    )
    expect(runtime.getDebugSnapshot().transactionState).toBe('queued')
    expect(runtime.getDebugSnapshot().destinationState).toBe('pendingData')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'needMessagesAround',
        reason: 'jump',
        target: { messageId: 'm-10000', position: 10000 },
      }),
    )
    expect(events.some((event) => event.type === 'viewportError')).toBe(false)

    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 2,
      effect: 'reset',
      start: 9986,
    }))
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    expect(runtime.getDebugSnapshot().destinationState).toBe('resolvingDom')
    expect(snapshot.items.some((item) =>
      item.key.kind === 'committed' && item.key.messageId === 'm-10000',
    )).toBe(true)
    expect(snapshot.items.length).toBeLessThanOrEqual(20)
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await flushMotion(scheduler)

    expect(runtime.getDebugSnapshot().readySubstate).toBe('READY_IDLE')
    expect(runtime.getDebugSnapshot().transactionState).toBe('queued')
    expect(runtime.getDebugSnapshot().destinationState).toBe('settled')
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
  })

  it('does not consume pending jump rebuild from a non-reset snapshot containing the target', async () => {
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
      target: { messageId: 'm-100', position: 100 },
    })
    await Promise.resolve()

    const beforeRevision = runtime.getSnapshot().revision

    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 2,
      effect: 'items-change',
      kind: 'patch',
      start: 86,
    }))
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().readySubstate).toBe(
      'READY_DESTINATION_PENDING',
    )
    expect(runtime.getDebugSnapshot().destinationState).toBe('pendingData')
    expect(runtime.getSnapshot().revision).toBe(beforeRevision)
    expect(
      events.filter((event) =>
        event.type === 'needMessagesAround' && event.reason === 'jump',
      ),
    ).toHaveLength(2)

    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 3,
      effect: 'reset',
      kind: 'reset',
      start: 86,
      anchor: { messageId: 'm-100', position: 100 },
    }))
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().destinationState).toBe('resolvingDom')
    expect(runtime.getSnapshot().items.some((item) =>
      item.key.kind === 'committed' && item.key.messageId === 'm-100',
    )).toBe(true)
  })

  it('rebuilds the latest window before follow-bottom when spacer is too large', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 300,
      revision: 1,
      effect: 'reset',
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    expect(runtime.getSnapshot().topSpacer).toBeGreaterThan(10_000)
    events.length = 0

    runtime.dispatch({ type: 'followBottom' })

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'needLatestMessages',
        reason: 'bottom-follow',
      }),
    )
  })

  it('requests an around-target rebuild for local jumps when spacer is too large', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 300,
      revision: 1,
      effect: 'reset',
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-100' } })

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'needMessagesAround',
        reason: 'jump',
        target: { messageId: 'm-100' },
      }),
    )
  })

  it('requests an around-target rebuild for local restores when spacer is too large', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 300,
      revision: 1,
      effect: 'reset',
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({
      type: 'restore',
      target: {
        key: { kind: 'committed', messageId: 'm-100' },
        offsetWithinMessage: 24,
      },
    })

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'needMessagesAround',
        reason: 'restore',
        target: { messageId: 'm-100' },
      }),
    )
  })

  it('requests viewport compaction on the next prepend when spacer is too large', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 300,
      revision: 1,
      effect: 'reset',
      estimatedHeight: 104,
      hasMoreAfter: true,
    }))
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: { messageId: 'm-150' },
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    mountProjection(runtime, container, runtime.getSnapshot(), -container.scrollTop)

    const beforeRevision = runtime.getSnapshot().revision
    expect(runtime.getSnapshot().topSpacer).toBeGreaterThan(10_000)
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    events.length = 0

    runtime.setDataSnapshot(createSnapshot({
      count: 320,
      revision: 2,
      effect: 'prepend',
      start: -19,
      estimatedHeight: 104,
      hasMoreAfter: true,
    }))
    await Promise.resolve()

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'needMessagesAround',
        reason: 'viewport-compaction',
        target: { messageId: 'm-149' },
      }),
    )
    expect(runtime.getSnapshot().revision).toBe(beforeRevision)
    expect(runtime.getDebugSnapshot().readySubstate).toBe(
      'READY_VIEWPORT_COMPACTION_PENDING',
    )
  })

  it('does not consume pending viewport compaction from a normal append snapshot', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 300,
      revision: 1,
      effect: 'reset',
      estimatedHeight: 104,
      hasMoreAfter: true,
    }))
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: { messageId: 'm-150' },
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    mountProjection(runtime, container, runtime.getSnapshot(), -container.scrollTop)
    events.length = 0

    runtime.setDataSnapshot(createSnapshot({
      count: 320,
      revision: 2,
      effect: 'prepend',
      start: -19,
      estimatedHeight: 104,
      hasMoreAfter: true,
    }))
    await Promise.resolve()

    const beforeRevision = runtime.getSnapshot().revision
    expect(runtime.getDebugSnapshot().readySubstate).toBe(
      'READY_VIEWPORT_COMPACTION_PENDING',
    )

    runtime.setDataSnapshot(createSnapshot({
      count: 340,
      revision: 3,
      effect: 'append',
      start: -19,
      estimatedHeight: 104,
      hasMoreAfter: true,
    }))
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().readySubstate).toBe(
      'READY_VIEWPORT_COMPACTION_PENDING',
    )
    expect(runtime.getSnapshot().revision).toBe(beforeRevision)
    expect(
      events.filter((event) =>
        event.type === 'needMessagesAround' &&
        event.reason === 'viewport-compaction',
      ),
    ).toHaveLength(2)
  })

  it('compacts the data window around the current visual anchor without moving it', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 300,
      revision: 1,
      effect: 'reset',
      estimatedHeight: 104,
      hasMoreAfter: true,
    }))
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: {
        key: { kind: 'committed', messageId: 'm-150' },
        offsetWithinMessage: 18,
      },
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    mountProjection(runtime, container, runtime.getSnapshot(), -container.scrollTop)

    runtime.setDataSnapshot(createSnapshot({
      count: 320,
      revision: 2,
      effect: 'prepend',
      start: -19,
      estimatedHeight: 104,
      hasMoreAfter: true,
    }))
    await Promise.resolve()

    const pendingSnapshot = runtime.getSnapshot()
    container.scrollTop = getExpectedRestoreScrollTop(
      pendingSnapshot,
      'm-155',
      22,
    )
    mountProjection(runtime, container, pendingSnapshot, -container.scrollTop)

    runtime.setDataSnapshot(createSnapshot({
      count: 41,
      revision: 3,
      effect: 'reset',
      start: 140,
      estimatedHeight: 104,
      hasMoreAfter: true,
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

    const settled = runtime.getSnapshot()
    expect(container.scrollTop).toBe(
      getExpectedRestoreScrollTop(settled, 'm-155', 22),
    )
    expect(settled.topSpacer).toBeLessThan(10_000)
    expect(settled.bottomSpacer).toBeLessThan(10_000)
    expect(runtime.getDebugSnapshot().readySubstate).toBe('READY_IDLE')
    expect(runtime.getDebugSnapshot().transactionState).toBe('idle')
  })

})
