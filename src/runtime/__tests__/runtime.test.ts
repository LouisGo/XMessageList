import { describe, expect, it } from 'vitest'
import {
  MessageViewportRuntime,
  type MessageDataSnapshot,
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
}): MessageDataSnapshot<TestMessage> {
  const start = input.start ?? 1

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
        estimatedHeight: 50,
      }
    }),
    anchor: { messageId: `m-${start + input.count - 1}` },
    anchorStatus: 'normal',
    hasMoreBefore: true,
    hasMoreAfter: false,
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

function createRuntime() {
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
    },
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

describe('MessageViewportRuntime', () => {
  it('keeps snapshot reference stable when projection does not change', () => {
    const { runtime } = createRuntime()
    const first = runtime.getSnapshot()
    const second = runtime.getSnapshot()

    expect(second).toBe(first)
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

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.setDataSnapshot(createSnapshot({ count: 31, revision: 2, effect: 'append' }))
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
    scheduler.flushFrame()
    await Promise.resolve()
    await Promise.resolve()
    scheduler.flushFrame()
    await Promise.resolve()
    snapshot = runtime.getSnapshot()

    expect(snapshot.bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)
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
    await Promise.resolve()
    await Promise.resolve()
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
    await flushFramesWithMicrotasks(scheduler, 3)

    snapshot = runtime.getSnapshot()
    expect(snapshot.renderWindow.endIndex).toBe(39)
    expect(snapshot.bottomLockState).toBe('LOCKED')
    expect(container.scrollTop).toBe(container.scrollHeight - container.clientHeight)
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
    container.scrollTop = 400
    await flushScrollFrames(container, scheduler, 3)

    container.scrollTop = 0
    await flushScrollFrames(container, scheduler, 1)

    expect(events.filter((event) => event === 'needMoreBefore')).toHaveLength(1)

    container.scrollTop = 400
    await flushScrollFrames(container, scheduler, 1)
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
    container.scrollTop = 400
    await flushScrollFrames(container, scheduler, 3)

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
