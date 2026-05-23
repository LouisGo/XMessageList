import { describe, expect, it } from 'vitest'
import {
  createContainer,
  createSnapshot,
  cloneSnapshotWithItems,
  createRuntime,
  mountProjection,
  flushBootstrap,
  commitCurrentProjection,
  flushMotion,
  flushScrollFrames,
  flushTrustedScrollFrame,
  markUserScrollIntent,
  startFollowBottomMotionFromMiddle,
} from './runtimeTestUtils'

describe('MessageViewportRuntime direct scroll and measurement', () => {
  it('defers edge status projection while bootstrap is waiting for its commit revision', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type === 'viewportError' ? event.code : event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()

    const pending = runtime.getSnapshot()
    expect(pending.bootstrapState).toBe('MOUNTING')

    runtime.dispatch({
      type: 'setEdgeStatus',
      edge: 'before',
      status: 'error',
    })

    expect(runtime.getSnapshot()).toBe(pending)
    expect(runtime.getSnapshot().edgeState.before).toBe('idle')

    mountProjection(runtime, container, pending)
    runtime.notifyProjectionCommitted({
      feedId: pending.feedId,
      generation: pending.generation,
      revision: pending.revision,
    })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    expect(events).not.toContain('commit-timeout-bootstrap')
    expect(runtime.getSnapshot().bootstrapState).toBe('READY')
    expect(runtime.getSnapshot().edgeState.before).toBe('error')
  })

  it('flushes deferred edge status when a ready detached runtime reattaches', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    await Promise.resolve()

    const readySnapshot = runtime.getSnapshot()
    expect(readySnapshot.bootstrapState).toBe('READY')
    expect(readySnapshot.edgeState.before).toBe('idle')

    runtime.detach()
    runtime.dispatch({ type: 'setEdgeStatus', edge: 'before', status: 'error' })

    expect(runtime.getSnapshot()).toBe(readySnapshot)
    expect(runtime.getSnapshot().edgeState.before).toBe('idle')

    runtime.attach(container)

    expect(runtime.getSnapshot().edgeState.before).toBe('error')
    expect(runtime.getSnapshot().revision).toBeGreaterThan(readySnapshot.revision)
  })

  it('latches top edge loading until the user leaves the edge', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 10, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    markUserScrollIntent(container)
    container.scrollTop = 400
    await flushScrollFrames(container, scheduler, 3)

    markUserScrollIntent(container)
    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)

    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(1)
    expect(runtime.getSnapshot().edgeState.before).toBe('loading')

    markUserScrollIntent(container)
    container.scrollTop = 400
    await flushScrollFrames(container, scheduler, 1)
    markUserScrollIntent(container)
    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)

    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(2)
  })

  it('projects edge error and clears loading after a successful prepend response', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 10, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    markUserScrollIntent(container)
    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)

    expect(runtime.getSnapshot().edgeState.before).toBe('loading')

    runtime.dispatch({
      type: 'setEdgeStatus',
      edge: 'before',
      status: 'error',
    })

    expect(runtime.getSnapshot().edgeState.before).toBe('error')

    runtime.setDataSnapshot(
      createSnapshot({ count: 30, revision: 2, effect: 'prepend', start: -19 }),
    )
    await Promise.resolve()

    expect(runtime.getSnapshot().edgeState.before).toBe('idle')
  })

  it('treats trusted scrollbar scroll as user edge intent', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 10, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    await flushScrollFrames(container, scheduler, 3)

    container.scrollTop = 0
    await flushTrustedScrollFrame(container, scheduler)

    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(1)
  })

  it('reports whether direct scrollbar scrollTop write reaches an attached container', () => {
    const { runtime } = createRuntime()
    const container = createContainer({ height: 300 })

    expect(
      runtime.writeDirectScrollTop(120, { source: 'custom-scrollbar-drag' }),
    ).toBe(false)
    expect(container.scrollTop).toBe(0)

    runtime.attach(container)

    expect(
      runtime.writeDirectScrollTop(120, { source: 'custom-scrollbar-drag' }),
    ).toBe(true)
    expect(container.scrollTop).toBe(120)

    runtime.destroy()

    expect(
      runtime.writeDirectScrollTop(240, { source: 'custom-scrollbar-drag' }),
    ).toBe(false)
    expect(container.scrollTop).toBe(120)
  })

  it('treats custom scrollbar drag as user edge intent', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 10, revision: 1, effect: 'reset', hasMoreAfter: true }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    await flushScrollFrames(container, scheduler, 3)

    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
    runtime.writeDirectScrollTop(
      Math.max(0, container.scrollHeight - container.clientHeight),
      { source: 'custom-scrollbar-drag' },
    )
    await flushTrustedScrollFrame(container, scheduler)
    runtime.endDirectScroll({ source: 'custom-scrollbar-drag' })

    expect(events.filter((event) => event === 'needMoreAfter')).toHaveLength(1)
  })

  it('cancels active motion when direct scrollbar drag begins', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['motion', 'scroll'],
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

    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })

    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getDiagnosticRecords()).toContainEqual(
      expect.objectContaining({
        name: 'destinationMotion.cancel',
        details: expect.objectContaining({
          reason: 'user-interrupt',
        }),
      }),
    )
  })

  it('continues top edge paging after prepend while scrollbar drag stays at the edge', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 10, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    await flushScrollFrames(container, scheduler, 3)

    container.scrollTop = 0
    await flushTrustedScrollFrame(container, scheduler)
    await flushTrustedScrollFrame(container, scheduler)
    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(1)

    runtime.setDataSnapshot(
      createSnapshot({ count: 30, revision: 2, effect: 'prepend', start: -20 }),
    )
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
    await flushScrollFrames(container, scheduler, 3)

    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(2)
  })

  it('continues bottom edge paging after append while scrollbar drag stays at the edge', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 10,
      revision: 1,
      effect: 'reset',
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    await flushScrollFrames(container, scheduler, 3)

    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    await flushTrustedScrollFrame(container, scheduler)
    expect(events.filter((event) => event === 'needMoreAfter')).toHaveLength(1)

    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 2,
      effect: 'append',
      hasMoreAfter: true,
    }))
    await Promise.resolve()
    const nextSlideSnapshot = runtime.getSnapshot()
    mountProjection(runtime, container, nextSlideSnapshot)
    runtime.notifyProjectionCommitted({
      feedId: nextSlideSnapshot.feedId,
      generation: nextSlideSnapshot.generation,
      revision: nextSlideSnapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()
    scheduler.flushFrame()
    await Promise.resolve()

    expect(events.filter((event) => event === 'needMoreAfter')).toHaveLength(2)
  })

  it('does not re-request bottom paging for non-append transactions while scrollbar drag stays at the edge', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({
      count: 10,
      revision: 1,
      effect: 'reset',
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    await flushScrollFrames(container, scheduler, 3)

    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
    runtime.writeDirectScrollTop(
      Math.max(0, container.scrollHeight - container.clientHeight),
      { source: 'custom-scrollbar-drag' },
    )
    await flushTrustedScrollFrame(container, scheduler)
    expect(events.filter((event) => event === 'needMoreAfter')).toHaveLength(1)

    runtime.setDataSnapshot(createSnapshot({
      count: 10,
      revision: 2,
      effect: 'items-change',
      hasMoreAfter: true,
    }))
    await Promise.resolve()
    const refreshSnapshot = runtime.getSnapshot()
    mountProjection(runtime, container, refreshSnapshot)
    runtime.notifyProjectionCommitted({
      feedId: refreshSnapshot.feedId,
      generation: refreshSnapshot.generation,
      revision: refreshSnapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()
    scheduler.flushFrame()
    await Promise.resolve()

    expect(events.filter((event) => event === 'needMoreAfter')).toHaveLength(1)

    runtime.endDirectScroll({ source: 'custom-scrollbar-drag' })
  })

  it('does not release top edge latch for recovery scroll after prepend', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: string[] = []

    runtime.subscribeEvent((event) => {
      events.push(event.type)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 10, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    markUserScrollIntent(container)
    container.scrollTop = 400
    await flushScrollFrames(container, scheduler, 3)

    markUserScrollIntent(container)
    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)
    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(1)

    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 2, effect: 'prepend', start: -19 }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, 400)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    await flushScrollFrames(container, scheduler, 1)
    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)

    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(1)
  })

  it('keeps anchor visual top during item height refresh', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    container.scrollTop = runtime.getSnapshot().topSpacer + 100
    mountProjection(runtime, container, runtime.getSnapshot(), -container.scrollTop)
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    await Promise.resolve()
    const scrollTopBeforeRefresh = container.scrollTop

    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 2, effect: 'items-change' }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, -container.scrollTop + 40)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBe(scrollTopBeforeRefresh + 40)
  })

  it('treats contentVersion changes as projection changes even when item version is stable', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    const initial = createSnapshot({ count: 30, revision: 1, effect: 'reset' })
    runtime.setDataSnapshot(initial)
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const before = runtime.getSnapshot()
    const items = initial.items
    const visibleItem = before.items[0]
    const targetIndex = items.findIndex((item) => item.key === visibleItem?.key)

    expect(targetIndex).toBeGreaterThanOrEqual(0)

    const target = items[targetIndex]

    if (!target || target.kind !== 'committed') {
      throw new Error('expected committed test item')
    }

    items[targetIndex] = {
      ...target,
      message: { ...target.message, text: `${target.message.text}-expanded` },
      version: target.version,
      contentVersion: (target.contentVersion ?? target.version) + 1,
      estimatedHeight: (target.estimatedHeight ?? 50) + 30,
    }

    runtime.setDataSnapshot(
      cloneSnapshotWithItems(initial, {
        revision: 2,
        items,
      }),
    )
    await Promise.resolve()
    const after = runtime.getSnapshot()

    expect(after.revision).toBeGreaterThan(before.revision)
    const updatedItem = after.items[0]

    expect(updatedItem && 'contentVersion' in updatedItem
      ? updatedItem.contentVersion
      : undefined).toBe((target.contentVersion ?? target.version) + 1)
  })

  it('invalidates render-window indexes when a new revision reuses the same items array', async () => {
    const { runtime, scheduler } = createRuntime({
      window: {
        maxMountedItems: 20,
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    const initial = createSnapshot({ count: 30, revision: 1, effect: 'reset' })
    const items = initial.items

    runtime.setDataSnapshot(initial)
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-1' } })
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    await flushMotion(scheduler)

    items.reverse()
    runtime.setDataSnapshot(
      cloneSnapshotWithItems(initial, {
        revision: 2,
        items,
      }),
    )
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-1' } })
    await Promise.resolve()
    const jumped = runtime.getSnapshot()

    expect(
      jumped.items.some(
        (item) => item.key.kind === 'committed' && item.key.messageId === 'm-1',
      ),
    ).toBe(true)
  })

  it('recomputes spacer estimates when a new revision reuses the same items array', async () => {
    const { runtime, scheduler } = createRuntime({
      window: {
        maxMountedItems: 20,
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    const initial = createSnapshot({
      count: 40,
      revision: 1,
      effect: 'reset',
      estimatedHeight: 50,
    })
    const items = initial.items

    runtime.setDataSnapshot(initial)
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const before = runtime.getSnapshot()

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]

      if (item && item.kind !== 'tombstone') {
        items[index] = {
          ...item,
          estimatedHeight: 80,
          contentVersion: (item.contentVersion ?? item.version) + 1,
        }
      }
    }

    runtime.setDataSnapshot(
      cloneSnapshotWithItems(initial, {
        revision: 2,
        items,
      }),
    )
    await Promise.resolve()
    const after = runtime.getSnapshot()

    expect(after.topSpacer).toBeGreaterThan(before.topSpacer)
  })
})
