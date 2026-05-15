import { describe, expect, it } from 'vitest'
import {
  MessageViewportRuntime,
  type MessageDataSnapshot,
  type MessageViewportRuntimeOptions,
  type ScrollMotionOptions,
  type MessageViewportRuntimeEvent,
  type WindowConfig,
  type MessageViewportSnapshot,
  serializeRuntimeItemKey,
} from '..'
import {
  createContainer,
  createFakeObservers,
  FakeScheduler,
  setElementMetrics,
} from '../../test/fakes'

type TestMessage = {
  id: string
  text: string
}

function createSnapshot(input: {
  count: number
  revision: number
  effect:
    | 'reset'
    | 'prepend'
    | 'append'
    | 'auto-scroll-to-bottom'
    | 'items-change'
  start?: number
  estimatedHeight?: number
  hasMoreAfter?: boolean
}): MessageDataSnapshot<TestMessage> {
  const start = input.start ?? 1
  const estimatedHeight = input.estimatedHeight ?? 50

  return {
    feedId: 'feed',
    generation: 1,
    revision: input.revision,
    items: Array.from({ length: input.count }, (_, index) => {
      const id = `m-${start + index}`

      return {
        kind: 'committed' as const,
        key: { kind: 'committed' as const, messageId: id },
        message: { id, text: id },
        version: 1,
        contentVersion: 1,
        estimatedHeight,
      }
    }),
    anchor: { messageId: `m-${start + input.count - 1}` },
    anchorStatus: 'normal',
    hasMoreBefore: true,
    hasMoreAfter: input.hasMoreAfter ?? false,
    change: {
      kind:
        input.effect === 'prepend'
          ? 'prepend'
          : input.effect === 'append' || input.effect === 'auto-scroll-to-bottom'
            ? 'append'
            : 'initial',
      viewportEffect: input.effect,
    },
  }
}

function createRuntime(input?: {
  window?: Partial<WindowConfig>
  scrollMotion?: Partial<ScrollMotionOptions>
  debug?: MessageViewportRuntimeOptions['debug']
}) {
  const scheduler = new FakeScheduler()
  const observers = createFakeObservers()
  const runtime = new MessageViewportRuntime<TestMessage>({
    feedId: 'feed',
    generation: 1,
    scheduler,
    observers,
    window: {
      minMountedItems: 10,
      maxMountedItems: 20,
      defaultItemHeight: 50,
      ...input?.window,
    },
    scrollMotion: input?.scrollMotion,
    debug: input?.debug,
  })

  return { runtime, scheduler, observers }
}

function mountProjection(
  runtime: MessageViewportRuntime<TestMessage>,
  container: HTMLElement,
  snapshot: MessageViewportSnapshot<TestMessage>,
  topOffset = 0,
  heightByMessageId: Record<string, number> = {},
): void {
  container.replaceChildren()

  const topSpacer = document.createElement('div')
  topSpacer.dataset.spacerHeight = String(snapshot.topSpacer)
  runtime.registerTopSpacer(topSpacer)
  container.append(topSpacer)

  let top = topOffset + snapshot.topSpacer

  for (const item of snapshot.items) {
    const row = document.createElement('div')
    const messageId = item.key.kind === 'committed' ? item.key.messageId : ''
    const height = heightByMessageId[messageId] ?? item.estimatedHeight ?? 50
    row.dataset.messageRow = serializeRuntimeItemKey(item.key)
    setElementMetrics(row, {
      top,
      height,
    })
    top += height
    container.append(row)
    runtime.registerRow(item.key, row)
  }

  const bottomSpacer = document.createElement('div')
  bottomSpacer.dataset.spacerHeight = String(snapshot.bottomSpacer)
  runtime.registerBottomSpacer(bottomSpacer)
  container.append(bottomSpacer)
}

async function flushBootstrap(
  runtime: MessageViewportRuntime<TestMessage>,
  scheduler: FakeScheduler,
  container: HTMLElement,
): Promise<void> {
  let snapshot = runtime.getSnapshot()
  mountProjection(runtime, container, snapshot)
  runtime.notifyProjectionCommitted({
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    revision: snapshot.revision,
  })
  await Promise.resolve()
  scheduler.flushFrame()
  await Promise.resolve()
  scheduler.flushFrame()
  await Promise.resolve()
  scheduler.flushFrame()
  await Promise.resolve()
  snapshot = runtime.getSnapshot()
  runtime.notifyProjectionCommitted({
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    revision: snapshot.revision,
  })
}

async function flushFramesWithMicrotasks(
  scheduler: FakeScheduler,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve()
    scheduler.flushFrame()
    await Promise.resolve()
  }
}

async function flushMotion(scheduler: FakeScheduler): Promise<void> {
  await flushFramesWithMicrotasks(scheduler, 35)
}

async function flushTransactionTimeout(scheduler: FakeScheduler): Promise<void> {
  scheduler.flushTimers()
  await Promise.resolve()
  await Promise.resolve()
}

async function flushScrollFrames(
  container: HTMLElement,
  scheduler: FakeScheduler,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    await Promise.resolve()
  }
}

function markUserScrollIntent(container: HTMLElement): void {
  container.dispatchEvent(new Event('wheel'))
}

function createHeightMap(
  start: number,
  end: number,
  height: number,
): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: end - start + 1 }, (_, index) => [
      `m-${start + index}`,
      height,
    ]),
  )
}

function getExpectedRestoreScrollTop(
  snapshot: MessageViewportSnapshot<TestMessage>,
  messageId: string,
  offsetWithinMessage: number,
  heightByMessageId: Record<string, number> = {},
): number {
  let top = snapshot.topSpacer

  for (const item of snapshot.items) {
    const currentMessageId =
      item.key.kind === 'committed' ? item.key.messageId : ''
    const height = heightByMessageId[currentMessageId] ?? item.estimatedHeight ?? 50

    if (currentMessageId === messageId) {
      return top + offsetWithinMessage
    }

    top += height
  }

  throw new Error(`message ${messageId} not found in snapshot`)
}

describe('MessageViewportRuntime', () => {
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
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
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
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
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
    runtime.dispatch({ type: 'jump', target: { messageId: 'm-10' } })
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

  it('recomputes the latest window on container height resize and keeps bottom lock', async () => {
    const { runtime, scheduler, observers } = createRuntime({
      window: {
        minMountedItems: 10,
        maxMountedItems: 60,
        defaultItemHeight: 50,
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
      value: 500,
    })

    observers.resizeObservers.at(-1)?.trigger(container, 500)
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
    snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.endIndex).toBeLessThan(39)

    runtime.dispatch({ type: 'followBottom' })
    await Promise.resolve()
    await Promise.resolve()
    snapshot = runtime.getSnapshot()
    expect(snapshot.bottomLockState).toBe('RECOVERING')
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
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
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
    expect(snapshot.bottomLockState).toBe('RECOVERING')

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

  it('sizes latest bootstrap window from viewport height instead of only minMountedItems', async () => {
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
    expect(snapshot.renderWindow.itemKeys).toHaveLength(37)
    expect(snapshot.renderWindow.itemKeys.length).toBeGreaterThan(10)
  })

  it('keeps the minMountedItems floor when latest anchor is at the data tail', async () => {
    const { runtime } = createRuntime({
      window: {
        defaultItemHeight: 400,
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

    runtime.dispatch({ type: 'jump', target: { messageId: 'm-10' } })
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
    await Promise.resolve()

    snapshot = runtime.getSnapshot()
    expect(snapshot.bottomLockState).toBe('RECOVERING')
    expect(snapshot.renderWindow.endIndex).toBe(59)
    expect(snapshot.renderWindow.itemKeys).toHaveLength(37)
  })

  it('keeps anchor visual top during prepend transaction', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset', start: 20 }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    container.scrollTop = 100

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

    expect(container.scrollTop).toBeGreaterThan(100)
  })

  it('recovers from prepend commit timeout without staying in RECOVERING', async () => {
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
    expect(snapshot.bottomLockState).toBe('RECOVERING')

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
    ).toHaveLength(2)

    const snapshot = runtime.getSnapshot()
    expect(snapshot.bottomLockState).toBe('RECOVERING')
    mountProjection(runtime, container, snapshot)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
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
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
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
    scheduler.flushFrame()
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()

    expect(runtime.getDebugSnapshot().lastScrollSource).toBe('jump')
  })

  it('cancels jump motion on user wheel and leaves the viewport unlocked', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
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
    expect(runtime.getDebugSnapshot().motionActive).toBe(true)

    container.dispatchEvent(new Event('wheel'))

    expect(runtime.getDebugSnapshot().state).toBe('READY')
    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
  })

  it('cancels active destination motion before stabilizing a row resize', async () => {
    const { runtime, scheduler, observers } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 60, revision: 1, effect: 'reset' }))
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
    expect(runtime.getSnapshot().bottomLockState).not.toBe('RECOVERING')

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
    expect(snapshot.bottomLockState).toBe('RECOVERING')

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

    markUserScrollIntent(container)
    container.scrollTop = 400
    await flushScrollFrames(container, scheduler, 1)
    markUserScrollIntent(container)
    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)

    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(2)
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
    container.scrollTop = 100
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    await Promise.resolve()

    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 2, effect: 'items-change' }))
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, 40)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBe(140)
  })
})
