import { StrictMode, act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      viewportModifier: 'reset',
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
  customScrollbar,
}: {
  runtime: MessageViewportRuntime<TestMessage>
  onViewportAnchorChange?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['onViewportAnchorChange']
  renderFollowBottom?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['renderFollowBottom']
  customScrollbar?: boolean
}) {
  return (
    <MessageViewport
      runtime={runtime}
      renderMessage={(item) =>
        item.kind === 'committed' ? <span>{item.message.id}</span> : null
      }
      renderFollowBottom={renderFollowBottom}
      onViewportAnchorChange={onViewportAnchorChange}
      customScrollbar={customScrollbar}
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
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

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
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
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

  it('does not re-run row renderers for projection-only snapshot updates', async () => {
    const listeners = new Set<() => void>()
    const itemA = {
      kind: 'committed' as const,
      key: { kind: 'committed' as const, messageId: 'm-1' },
      message: { id: 'm-1' },
      version: 1,
      contentVersion: 1,
      estimatedHeight: 48,
    }
    const itemB = {
      kind: 'committed' as const,
      key: { kind: 'committed' as const, messageId: 'm-2' },
      message: { id: 'm-2' },
      version: 1,
      contentVersion: 1,
      estimatedHeight: 48,
    }
    let snapshot: MessageViewportSnapshot<TestMessage> = {
      feedId: 'feed',
      generation: 1,
      revision: 1,
      items: [itemA, itemB],
      renderWindow: {
        startIndex: 0,
        endIndex: 1,
        itemKeys: [itemA.key, itemB.key],
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
      beginDirectScroll: vi.fn(),
      writeDirectScrollTop: vi.fn(),
      endDirectScroll: vi.fn(),
      getViewportAnchorState: vi.fn(() => null),
      getDiagnosticRecords: vi.fn(() => []),
      getDebugSnapshot: vi.fn(),
    } as unknown as MessageViewportRuntime<TestMessage>
    const renderMessage = vi.fn((item: MessageDataSnapshot<TestMessage>['items'][number]) =>
      item.kind === 'committed' ? <span>{item.message.id}</span> : null,
    )
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageViewport
          runtime={runtime}
          renderMessage={renderMessage}
          customScrollbar={false}
        />,
      )
    })

    expect(renderMessage).toHaveBeenCalledTimes(2)

    await act(async () => {
      snapshot = {
        ...snapshot,
        revision: 2,
        topSpacer: 24,
        viewportPhase: 'PROJECTING',
      }
      for (const listener of listeners) {
        listener()
      }
    })

    expect(renderMessage).toHaveBeenCalledTimes(2)

    await act(async () => {
      snapshot = {
        ...snapshot,
        revision: 3,
        viewportPhase: 'IDLE',
        items: [
          itemA,
          {
            ...itemB,
            contentVersion: 2,
          },
        ],
      }
      for (const listener of listeners) {
        listener()
      }
    })

    expect(renderMessage).toHaveBeenCalledTimes(3)

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

  it('renders a custom scrollbar overlay and hides native scrollbar styling', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1200,
    })

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    expect(
      host.querySelector('[data-custom-scrollbar="true"] style')?.textContent,
    ).toContain('scrollbar-width: none')
    expect(host.querySelector('[data-testid="custom-scrollbar"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="custom-scrollbar-thumb"]')).not.toBeNull()

    await act(async () => {
      root.unmount()
    })
  })

  it('keeps native scrollbar styling when custom scrollbar is disabled', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <ViewportOnlyHarness runtime={runtime} customScrollbar={false} />,
      )
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    expect(host.querySelector('[data-custom-scrollbar="false"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="custom-scrollbar"]')).toBeNull()
    expect(host.querySelector('.x-message-scrollbar')).toBeNull()
    expect(host.querySelector('style')?.textContent ?? '').not.toContain(
      'scrollbar-width: none',
    )
    expect(scrollContainer?.style.scrollbarWidth).toBe('')
    expect(
      (scrollContainer?.style as CSSStyleDeclaration & { msOverflowStyle?: string })
        .msOverflowStyle ?? '',
    ).toBe('')

    await act(async () => {
      root.unmount()
    })
  })

  it('maps custom thumb dragging to native scrollTop through runtime direct-scroll APIs', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1200,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    const thumb = host.querySelector<HTMLElement>(
      '[data-testid="custom-scrollbar-thumb"]',
    )
    expect(thumb).not.toBeNull()
    if (!thumb) {
      return
    }

    await act(async () => {
      thumb.dispatchEvent(createPointerEvent('pointerdown', 20, 1))
      document.dispatchEvent(createPointerEvent('pointermove', 80, 1))
      document.dispatchEvent(createPointerEvent('pointerup', 80, 1))
    })

    expect(scrollContainer.scrollTop).toBeGreaterThan(0)
    expect(runtime.beginDirectScroll).toHaveBeenCalledWith({
      source: 'custom-scrollbar-drag',
    })
    expect(runtime.writeDirectScrollTop).toHaveBeenCalledWith(
      expect.any(Number),
      { source: 'custom-scrollbar-drag' },
    )
    expect(runtime.endDirectScroll).toHaveBeenCalledWith({
      source: 'custom-scrollbar-drag',
    })
    expect(runtime.dispatch).not.toHaveBeenCalled()
    expect(document.body.classList.contains('x-message-scrollbar-dragging')).toBe(
      false,
    )

    await act(async () => {
      root.unmount()
    })
  })

  it('coalesces custom thumb pointer moves into one animation-frame scroll write', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)
    const frameCallbacks: FrameRequestCallback[] = []

    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1200,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    while (frameCallbacks.length > 0) {
      frameCallbacks.shift()?.(0)
    }
    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })
    while (frameCallbacks.length > 0) {
      frameCallbacks.shift()?.(0)
    }

    const thumb = host.querySelector<HTMLElement>(
      '[data-testid="custom-scrollbar-thumb"]',
    )
    expect(thumb).not.toBeNull()
    if (!thumb) {
      return
    }

    runtime.writeDirectScrollTop.mockClear()

    await act(async () => {
      thumb.dispatchEvent(createPointerEvent('pointerdown', 20, 1))
      document.dispatchEvent(createPointerEvent('pointermove', 60, 1))
      document.dispatchEvent(createPointerEvent('pointermove', 80, 1))
      document.dispatchEvent(createPointerEvent('pointermove', 100, 1))
    })

    expect(runtime.writeDirectScrollTop).not.toHaveBeenCalled()

    while (frameCallbacks.length > 0) {
      frameCallbacks.shift()?.(16)
    }

    expect(runtime.writeDirectScrollTop).toHaveBeenCalledTimes(1)
    expect(scrollContainer.scrollTop).toBeGreaterThan(0)

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointerup', 100, 1))
      root.unmount()
    })
  })

  it('keeps custom thumb dragging functional with a real attached runtime', async () => {
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
      debug: {
        diagnostics: {
          channels: ['scroll'],
          emitEvents: false,
          maxEntries: 20,
        },
      },
    })
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(<TestHarness runtime={runtime} hasMoreAfter />)
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1200,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    const thumb = host.querySelector<HTMLElement>(
      '[data-testid="custom-scrollbar-thumb"]',
    )
    expect(thumb).not.toBeNull()
    if (!thumb) {
      return
    }

    await act(async () => {
      thumb.dispatchEvent(createPointerEvent('pointerdown', 20, 1))
      document.dispatchEvent(createPointerEvent('pointermove', 80, 1))
      document.dispatchEvent(createPointerEvent('pointerup', 80, 1))
    })

    expect(scrollContainer.scrollTop).toBeGreaterThan(0)
    expect(runtime.getDiagnosticRecords()).toContainEqual(
      expect.objectContaining({
        name: 'scroll.direct.write',
        details: expect.objectContaining({
          source: 'custom-scrollbar-drag',
        }),
      }),
    )

    await act(async () => {
      root.unmount()
    })
  })

  it('maps custom track page jump through runtime direct-scroll APIs', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1200,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    const track = host.querySelector<HTMLElement>(
      '[data-testid="custom-scrollbar"]',
    )
    expect(track).not.toBeNull()
    if (!track) {
      return
    }

    await act(async () => {
      track.dispatchEvent(createPointerEvent('pointerdown', 200, 1))
    })

    expect(scrollContainer.scrollTop).toBeGreaterThan(0)
    expect(runtime.beginDirectScroll).toHaveBeenCalledWith({
      source: 'custom-scrollbar-track',
    })
    expect(runtime.writeDirectScrollTop).toHaveBeenCalledWith(
      expect.any(Number),
      { source: 'custom-scrollbar-track' },
    )
    expect(runtime.endDirectScroll).toHaveBeenCalledWith({
      source: 'custom-scrollbar-track',
    })

    await act(async () => {
      root.unmount()
    })
  })

  it('rebases active custom thumb drag after content growth changes scroll geometry', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scrollHeight = 1200

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    const thumb = host.querySelector<HTMLElement>(
      '[data-testid="custom-scrollbar-thumb"]',
    )
    expect(thumb).not.toBeNull()
    if (!thumb) {
      return
    }

    await act(async () => {
      thumb.dispatchEvent(createPointerEvent('pointerdown', 20, 1))
    })

    scrollHeight = 1800
    scrollContainer.scrollTop = 600

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointermove', 10, 1))
    })

    expect(scrollContainer.scrollTop).toBeGreaterThan(0)
    expect(scrollContainer.scrollTop).toBeLessThan(600)

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointerup', 10, 1))
      root.unmount()
    })
  })

  it('does not let drag-owned sync suppress a later projection rebase in the same frame', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scrollHeight = 1200
    const frameCallbacks: FrameRequestCallback[] = []

    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    while (frameCallbacks.length > 0) {
      frameCallbacks.shift()?.(0)
    }
    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })
    while (frameCallbacks.length > 0) {
      frameCallbacks.shift()?.(0)
    }

    const thumb = host.querySelector<HTMLElement>(
      '[data-testid="custom-scrollbar-thumb"]',
    )
    expect(thumb).not.toBeNull()
    if (!thumb) {
      return
    }

    await act(async () => {
      thumb.dispatchEvent(createPointerEvent('pointerdown', 20, 1))
      document.dispatchEvent(createPointerEvent('pointermove', 80, 1))
    })

    scrollHeight = 1800
    scrollContainer.scrollTop = 600
    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    while (frameCallbacks.length > 0) {
      frameCallbacks.shift()?.(16)
    }

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointermove', 70, 1))
    })

    expect(scrollContainer.scrollTop).toBeGreaterThan(0)
    expect(scrollContainer.scrollTop).toBeLessThan(600)

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointerup', 70, 1))
      root.unmount()
    })
  })

  it('continues active drag linearly after prepend-like geometry growth with the pointer outside the track', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scrollHeight = 1200

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    })

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    const thumb = host.querySelector<HTMLElement>(
      '[data-testid="custom-scrollbar-thumb"]',
    )
    expect(thumb).not.toBeNull()
    if (!thumb) {
      return
    }

    await act(async () => {
      thumb.dispatchEvent(createPointerEvent('pointerdown', 20, 1))
      document.dispatchEvent(createPointerEvent('pointermove', -500, 1))
    })

    scrollHeight = 1800
    scrollContainer.scrollTop = 600

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    expect(scrollContainer.scrollTop).toBe(600)

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointermove', -501, 1))
    })

    expect(scrollContainer.scrollTop).toBeLessThan(600)
    expect(scrollContainer.scrollTop).toBeGreaterThan(550)

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointerup', -501, 1))
      root.unmount()
    })
  })

  it('continues active drag linearly after append-like geometry growth moves the thumb upward', async () => {
    const runtime = createMockRuntime()
    const host = document.createElement('div')
    const root = createRoot(host)
    let scrollHeight = 1200
    let scrollTop = 480

    await act(async () => {
      root.render(<ViewportOnlyHarness runtime={runtime} customScrollbar />)
    })

    const scrollContainer = host.querySelector<HTMLElement>(
      '[data-message-scroll-container]',
    )
    expect(scrollContainer).not.toBeNull()
    if (!scrollContainer) {
      return
    }

    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 240,
    })
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value
      },
    })

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    const thumb = host.querySelector<HTMLElement>(
      '[data-testid="custom-scrollbar-thumb"]',
    )
    expect(thumb).not.toBeNull()
    if (!thumb) {
      return
    }

    await act(async () => {
      thumb.dispatchEvent(createPointerEvent('pointerdown', 120, 1))
    })

    scrollHeight = 1800

    await act(async () => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    expect(scrollContainer.scrollTop).toBe(480)

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointermove', 150, 1))
    })

    expect(scrollContainer.scrollTop).toBeGreaterThan(480)
    expect(scrollContainer.scrollTop).toBeLessThan(800)

    await act(async () => {
      document.dispatchEvent(createPointerEvent('pointerup', 150, 1))
      root.unmount()
    })
  })
})

function createMockRuntime(): MessageViewportRuntime<TestMessage> & {
  dispatch: ReturnType<typeof vi.fn>
  beginDirectScroll: ReturnType<typeof vi.fn>
  writeDirectScrollTop: ReturnType<typeof vi.fn>
  endDirectScroll: ReturnType<typeof vi.fn>
} {
  let attachedContainer: HTMLElement | null = null
  const snapshot: MessageViewportSnapshot<TestMessage> = {
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
    bottomLockState: 'LOCKED',
    bootstrapState: 'READY_EMPTY',
    viewportPhase: 'IDLE',
    edgeState: {
      before: 'idle',
      after: 'idle',
    },
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => () => {}),
    attach: vi.fn((container: HTMLElement) => {
      attachedContainer = container
    }),
    detach: vi.fn(() => {
      attachedContainer = null
    }),
    destroy: vi.fn(),
    setDataSnapshot: vi.fn(),
    dispatch: vi.fn(),
    beginDirectScroll: vi.fn(),
    writeDirectScrollTop: vi.fn((scrollTop: number) => {
      if (attachedContainer) {
        attachedContainer.scrollTop = scrollTop
        return true
      }

      return false
    }),
    endDirectScroll: vi.fn(),
    notifyProjectionCommitted: vi.fn(),
    registerRow: vi.fn(),
    registerTopSentinel: vi.fn(),
    registerBottomSentinel: vi.fn(),
    registerTopSpacer: vi.fn(),
    registerBottomSpacer: vi.fn(),
    subscribeEvent: vi.fn(() => () => {}),
    getViewportAnchorState: vi.fn(() => null),
    getDiagnosticRecords: vi.fn(() => []),
    getDebugSnapshot: vi.fn(),
  } as unknown as MessageViewportRuntime<TestMessage> & {
    dispatch: ReturnType<typeof vi.fn>
    beginDirectScroll: ReturnType<typeof vi.fn>
    writeDirectScrollTop: ReturnType<typeof vi.fn>
    endDirectScroll: ReturnType<typeof vi.fn>
  }
}

function createPointerEvent(
  type: string,
  clientY: number,
  pointerId: number,
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
    button: 0,
  })
  Object.defineProperty(event, 'pointerId', {
    configurable: true,
    value: pointerId,
  })
  return event
}
