import { expect } from 'vitest'
import {
  MessageViewportRuntime,
  type MessageDataSnapshot,
  type MessageViewportRuntimeOptions,
  type ScrollMotionOptions,
  type WindowConfig,
  type MessageViewportSnapshot,
  serializeRuntimeItemKey,
} from '..'
import {
  createFakeObservers,
  FakeScheduler,
  setElementMetrics,
} from '../../test/fakes'
export { createContainer, setElementMetrics } from '../../test/fakes'

export type TestMessage = {
  id: string
  text: string
}

export function createSnapshot(input: {
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
  kind?: MessageDataSnapshot['change']['kind']
  anchor?: MessageDataSnapshot['anchor']
  anchorStatus?: MessageDataSnapshot['anchorStatus']
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
    anchor: input.anchor ?? { messageId: `m-${start + input.count - 1}` },
    anchorStatus: input.anchorStatus ?? 'normal',
    hasMoreBefore: true,
    hasMoreAfter: input.hasMoreAfter ?? false,
    change: {
      kind:
        input.kind ??
        (input.effect === 'prepend'
          ? 'prepend'
          : input.effect === 'append' || input.effect === 'auto-scroll-to-bottom'
            ? 'append'
            : input.effect === 'reset'
              ? 'reset'
              : 'patch'),
      viewportModifier: input.effect,
    },
  }
}

export function cloneSnapshotWithItems(
  snapshot: MessageDataSnapshot<TestMessage>,
  input: {
    revision: number
    items: MessageDataSnapshot<TestMessage>['items']
    effect?: 'items-change' | 'reset'
  },
): MessageDataSnapshot<TestMessage> {
  const lastItem = input.items.at(-1)

  return {
    ...snapshot,
    revision: input.revision,
    items: input.items,
    anchor:
      lastItem?.key.kind === 'committed'
        ? { messageId: lastItem.key.messageId }
        : snapshot.anchor,
    change: {
      kind: 'patch',
      viewportModifier: input.effect ?? 'items-change',
    },
  }
}

export function createRuntime(input?: {
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
      maxMountedItems: 20,
      ...input?.window,
    },
    scrollMotion: input?.scrollMotion,
    debug: input?.debug,
  })

  return { runtime, scheduler, observers }
}

export function mountProjection(
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

export async function flushBootstrap(
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

export async function commitCurrentProjection(
  runtime: MessageViewportRuntime<TestMessage>,
  container: HTMLElement,
  topOffset = 0,
  heightByMessageId: Record<string, number> = {},
): Promise<MessageViewportSnapshot<TestMessage>> {
  const snapshot = runtime.getSnapshot()
  mountProjection(runtime, container, snapshot, topOffset, heightByMessageId)
  runtime.notifyProjectionCommitted({
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    revision: snapshot.revision,
  })
  await Promise.resolve()
  await Promise.resolve()
  return runtime.getSnapshot()
}

export async function flushFramesWithMicrotasks(
  scheduler: FakeScheduler,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve()
    scheduler.flushFrame()
    await Promise.resolve()
  }
}

export async function flushMotion(scheduler: FakeScheduler): Promise<void> {
  await flushFramesWithMicrotasks(scheduler, 35)
}

export async function flushTransactionTimeout(scheduler: FakeScheduler): Promise<void> {
  scheduler.flushTimers()
  await Promise.resolve()
  await Promise.resolve()
}

export async function flushScrollFrames(
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

export async function flushTrustedScrollFrame(
  container: HTMLElement,
  scheduler: FakeScheduler,
): Promise<void> {
  container.dispatchEvent(new MouseEvent('mousedown'))
  container.dispatchEvent(new UIEvent('scroll'))
  scheduler.flushFrame()
  await Promise.resolve()
}

export function markUserScrollIntent(container: HTMLElement): void {
  container.dispatchEvent(new Event('wheel'))
}

export function createHeightMap(
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

export function getExpectedRestoreScrollTop(
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

export async function startFollowBottomMotionFromMiddle(input: {
  runtime: MessageViewportRuntime<TestMessage>
  scheduler: FakeScheduler
  container: HTMLElement
  targetMessageId?: string
}): Promise<void> {
  const targetMessageId = input.targetMessageId ?? 'm-35'

  input.runtime.dispatch({ type: 'jump', target: { messageId: targetMessageId } })
  await Promise.resolve()
  await commitCurrentProjection(input.runtime, input.container)
  await flushMotion(input.scheduler)
  expect(input.runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')

  input.runtime.dispatch({ type: 'followBottom' })
  await Promise.resolve()
  await commitCurrentProjection(input.runtime, input.container)
  expect(input.runtime.getDebugSnapshot().motionActive).toBe(true)
}
