import { StrictMode, act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  MessageViewport,
  MessageViewportRuntime,
  type MessageDataSnapshot,
  type MessageViewportSnapshot,
} from '../..'
import { FakeScheduler, createFakeObservers } from '../../test/fakes'

type TestMessage = {
  id: string
}

function createSnapshot(input?: {
  feedId?: string
  messagePrefix?: string
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
}): MessageDataSnapshot<TestMessage> {
  const feedId = input?.feedId ?? 'feed'
  const messagePrefix = input?.messagePrefix ?? 'm'

  return {
    feedId,
    generation: 1,
    revision: 1,
    items: Array.from({ length: 12 }, (_, index) => ({
      kind: 'committed' as const,
      key: { kind: 'committed' as const, messageId: `${messagePrefix}-${index}` },
      message: { id: `${messagePrefix}-${index}` },
      version: 1,
      contentVersion: 1,
      estimatedHeight: 48,
    })),
    anchor: { messageId: `${messagePrefix}-11` },
    anchorStatus: 'normal',
    hasMoreBefore: input?.hasMoreBefore ?? false,
    hasMoreAfter: input?.hasMoreAfter ?? false,
    change: {
      kind: 'initial',
      viewportEffect: 'reset',
    },
  }
}

function TestHarness({
  runtime,
  hasMoreBefore,
  hasMoreAfter,
  onViewportAnchorChange,
}: {
  runtime: MessageViewportRuntime<TestMessage>
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
  onViewportAnchorChange?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['onViewportAnchorChange']
}) {
  useEffect(() => {
    runtime.setDataSnapshot(createSnapshot({ hasMoreBefore, hasMoreAfter }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
  }, [hasMoreAfter, hasMoreBefore, runtime])

  return (
    <MessageViewport
      runtime={runtime}
      renderMessage={(item) =>
        item.kind === 'committed' ? <span>{item.message.id}</span> : null
      }
      renderTopEdge={(snapshot) => (
        <div data-testid="top-edge">{snapshot.edgeState.before}</div>
      )}
      renderBottomEdge={(snapshot) => (
        <div data-testid="bottom-edge">{snapshot.edgeState.after}</div>
      )}
      onViewportAnchorChange={onViewportAnchorChange}
      style={{ height: 240 }}
    />
  )
}

function ViewportOnlyHarness({
  runtime,
  onViewportAnchorChange,
  renderFollowBottom,
}: {
  runtime: MessageViewportRuntime<TestMessage>
  onViewportAnchorChange?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['onViewportAnchorChange']
  renderFollowBottom?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['renderFollowBottom']
}) {
  return (
    <MessageViewport
      runtime={runtime}
      renderMessage={(item) =>
        item.kind === 'committed' ? <span>{item.message.id}</span> : null
      }
      renderFollowBottom={renderFollowBottom}
      onViewportAnchorChange={onViewportAnchorChange}
      style={{ height: 240 }}
    />
  )
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

describe('React adapter', () => {
  it('commits projection through layout effect and supports StrictMode remount', async () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = new MessageViewportRuntime<TestMessage>({
      feedId: 'feed',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const notify = vi.spyOn(runtime, 'notifyProjectionCommitted')
    const host = document.createElement('div')
    const root = createRoot(host)

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    })

    await act(async () => {
      root.render(
        <StrictMode>
          <TestHarness runtime={runtime} />
        </StrictMode>,
      )
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    expect(notify).toHaveBeenCalled()
    expect(host.querySelector('[data-message-viewport]')).not.toBeNull()
    expect(host.querySelector('[data-testid="bottom-edge"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-message-row]').length).toBeGreaterThan(0)

    await act(async () => {
      root.unmount()
    })

    expect(runtime.getDebugSnapshot().state).toBe('DETACHED')
  })

  it('subscribes before attaching a runtime with pending restored bootstrap', async () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = new MessageViewportRuntime<TestMessage>({
      feedId: 'feed',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const events: unknown[] = []
    const host = document.createElement('div')
    const root = createRoot(host)

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    })

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.setDataSnapshot(createSnapshot({ hasMoreBefore: true }))
    runtime.dispatch({
      type: 'bootstrap',
      mode: 'restored',
      target: {
        key: { kind: 'committed', messageId: 'm-6' },
        offsetWithinMessage: 0,
      },
    })

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} />)
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'viewportReady' }),
    )
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'viewportError' }),
    )
    expect(runtime.getDebugSnapshot().state).toBe('READY')
    expect(host.querySelectorAll('[data-message-row]').length).toBeGreaterThan(0)
  })

  it('owns standard follow-bottom UI and anchor event wiring', async () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = new MessageViewportRuntime<TestMessage>({
      feedId: 'feed',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const dispatch = vi.spyOn(runtime, 'dispatch')
    const onViewportAnchorChange = vi.fn()
    const host = document.createElement('div')
    const root = createRoot(host)

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    })

    await act(async () => {
      root.render(
        <TestHarness
          runtime={runtime}
          hasMoreAfter
          onViewportAnchorChange={onViewportAnchorChange}
        />,
      )
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    const followButton = host.querySelector<HTMLButtonElement>(
      '[data-message-follow-bottom]',
    )
    expect(host.querySelector('[data-testid="top-edge"]')?.textContent).toBe(
      'exhausted',
    )
    expect(followButton).not.toBeNull()
    expect(onViewportAnchorChange).toHaveBeenCalled()
    expect(onViewportAnchorChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        type: 'viewportAnchorChanged',
        feedId: 'feed',
        reason: 'transaction-settle',
      }),
    )

    await act(async () => {
      followButton?.click()
    })

    expect(dispatch).toHaveBeenCalledWith({ type: 'followBottom' })
    await act(async () => {
      root.unmount()
    })
  })

  it('keeps follow-bottom visibility driven by bottom lock during motion phase', async () => {
    const listeners = new Set<() => void>()
    let snapshot: MessageViewportSnapshot<TestMessage> = {
      feedId: 'feed',
      generation: 1,
      revision: 1,
      items: [],
      renderWindow: {
        startIndex: 0,
        endIndex: -1,
        itemKeys: [],
      },
      topSpacer: 0,
      bottomSpacer: 0,
      bottomLockState: 'UNLOCKED',
      bootstrapState: 'READY',
      viewportPhase: 'IDLE',
      edgeState: {
        before: 'idle',
        after: 'idle',
      },
    }
    const runtime = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)

        return () => {
          listeners.delete(listener)
        }
      },
      attach: vi.fn(),
      detach: vi.fn(),
      dispatch: vi.fn(),
      notifyProjectionCommitted: vi.fn(),
      registerRow: vi.fn(),
      registerTopSentinel: vi.fn(),
      registerBottomSentinel: vi.fn(),
      registerTopSpacer: vi.fn(),
      registerBottomSpacer: vi.fn(),
      subscribeEvent: vi.fn(() => () => {}),
    } as unknown as MessageViewportRuntime<TestMessage>
    const renderFollowBottom = vi.fn(() => (
      <button type="button" data-testid="custom-follow-bottom">
        Bottom
      </button>
    ))
    const host = document.createElement('div')
    const root = createRoot(host)

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    })

    await act(async () => {
      root.render(
        <ViewportOnlyHarness
          runtime={runtime}
          renderFollowBottom={renderFollowBottom}
        />,
      )
    })

    expect(host.querySelector('[data-testid="custom-follow-bottom"]')).not.toBeNull()

    await act(async () => {
      snapshot = {
        ...snapshot,
        revision: 2,
        viewportPhase: 'MOTION_ACTIVE',
      }
      for (const listener of listeners) {
        listener()
      }
    })

    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION_ACTIVE')
    expect(host.querySelector('[data-testid="custom-follow-bottom"]')).not.toBeNull()

    await act(async () => {
      root.unmount()
    })
  })

  it('detaches the old runtime and attaches the new one when runtime changes', async () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtimeA = new MessageViewportRuntime<TestMessage>({
      feedId: 'feed-a',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const runtimeB = new MessageViewportRuntime<TestMessage>({
      feedId: 'feed-b',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const attachA = vi.spyOn(runtimeA, 'attach')
    const detachA = vi.spyOn(runtimeA, 'detach')
    const attachB = vi.spyOn(runtimeB, 'attach')
    const detachB = vi.spyOn(runtimeB, 'detach')
    const host = document.createElement('div')
    const root = createRoot(host)

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    })

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtimeA} />)
    })

    expect(attachA).toHaveBeenCalled()
    expect(detachA).not.toHaveBeenCalled()

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (scrollContainer) {
      scrollContainer.scrollTop = 123
    }

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtimeB} />)
    })

    expect(detachA).toHaveBeenCalled()
    expect(attachB).toHaveBeenCalled()
    expect(detachB).not.toHaveBeenCalled()
    expect(
      host.querySelector<HTMLElement>('[data-message-scroll-container]')
        ?.scrollTop,
    ).toBe(0)

    const nextScrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    if (nextScrollContainer) {
      nextScrollContainer.scrollTop = 45
    }

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtimeA} />)
    })

    expect(detachB).toHaveBeenCalled()
    expect(attachA).toHaveBeenCalledTimes(2)
    expect(
      host.querySelector<HTMLElement>('[data-message-scroll-container]')
        ?.scrollTop,
    ).toBe(123)

    await act(async () => {
      root.unmount()
    })

    expect(detachA).toHaveBeenCalledTimes(2)
  })

  it('detaches the previous runtime before projecting the next runtime DOM', async () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtimeA = new MessageViewportRuntime<TestMessage>({
      feedId: 'feed-a',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const runtimeB = new MessageViewportRuntime<TestMessage>({
      feedId: 'feed-b',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const onViewportAnchorChange = vi.fn()

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    })

    runtimeA.setDataSnapshot(
      createSnapshot({ feedId: 'feed-a', messagePrefix: 'a' }),
    )
    runtimeA.dispatch({ type: 'bootstrap', mode: 'latest' })
    runtimeB.setDataSnapshot(
      createSnapshot({ feedId: 'feed-b', messagePrefix: 'b' }),
    )
    runtimeB.dispatch({ type: 'bootstrap', mode: 'latest' })

    await act(async () => {
      root.render(
        <ViewportOnlyHarness
          runtime={runtimeA}
          onViewportAnchorChange={onViewportAnchorChange}
        />,
      )
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    expect(host.textContent).toContain('a-')
    onViewportAnchorChange.mockClear()
    const detachDomSnapshots: string[] = []
    const originalDetach = runtimeA.detach.bind(runtimeA)

    vi.spyOn(runtimeA, 'detach').mockImplementation(() => {
      detachDomSnapshots.push(host.textContent ?? '')
      originalDetach()
    })

    await act(async () => {
      root.render(
        <ViewportOnlyHarness
          runtime={runtimeB}
          onViewportAnchorChange={onViewportAnchorChange}
        />,
      )
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    expect(detachDomSnapshots[0]).toContain('a-')
    expect(detachDomSnapshots[0]).not.toContain('b-')
    expect(onViewportAnchorChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'viewportAnchorChanged',
        feedId: 'feed-a',
        generation: 1,
        reason: 'detach',
        anchor: expect.objectContaining({
          key: expect.objectContaining({ kind: 'committed' }),
        }),
      }),
    )
    expect(host.textContent).toContain('b-')

    await act(async () => {
      root.unmount()
    })
  })

  it('keeps anchor checkpoint subscribed through full viewport unmount', async () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = new MessageViewportRuntime<TestMessage>({
      feedId: 'feed',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const host = document.createElement('div')
    const root = createRoot(host)
    const onViewportAnchorChange = vi.fn()

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 320,
    })

    runtime.setDataSnapshot(createSnapshot())
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })

    await act(async () => {
      root.render(
        <ViewportOnlyHarness
          runtime={runtime}
          onViewportAnchorChange={onViewportAnchorChange}
        />,
      )
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    onViewportAnchorChange.mockClear()

    await act(async () => {
      root.unmount()
    })

    expect(onViewportAnchorChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'viewportAnchorChanged',
        feedId: 'feed',
        generation: 1,
        reason: 'detach',
        anchor: expect.objectContaining({
          key: expect.objectContaining({ kind: 'committed' }),
        }),
      }),
    )
  })
})
