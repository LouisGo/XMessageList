import { StrictMode, act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MessageViewport,
  MessageViewportRuntime,
  useMessageViewportSelector,
  useMessageViewportSnapshot,
  type MessageDataSnapshot,
  type MessageViewportSnapshot,
  type ViewportObservationChangedEvent,
} from '../..'
import { useStableCallback } from '../hooks/stableState'
import {
  FakeScheduler,
  createFakeObservers,
  setElementMetrics,
} from '../../test/fakes'

type TestMessage = {
  id: string
}

type TestDraft = {
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
  onViewportAnchorChanged,
  onViewportObservation,
  renderViewportOverlay,
}: {
  runtime: MessageViewportRuntime<TestMessage>
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
  onViewportAnchorChanged?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['onViewportAnchorChanged']
  onViewportObservation?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['onViewportObservation']
  renderViewportOverlay?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['renderViewportOverlay']
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
      onViewportAnchorChanged={onViewportAnchorChanged}
      onViewportObservation={onViewportObservation}
      renderViewportOverlay={renderViewportOverlay}
      style={{ height: 240 }}
    />
  )
}

function ViewportOnlyHarness({
  runtime,
  onViewportAnchorChanged,
  renderFollowBottom,
  renderViewportOverlay,
  scrollbar,
}: {
  runtime: MessageViewportRuntime<TestMessage>
  onViewportAnchorChanged?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['onViewportAnchorChanged']
  renderFollowBottom?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['renderFollowBottom']
  renderViewportOverlay?: Parameters<
    typeof MessageViewport<TestMessage>
  >[0]['renderViewportOverlay']
  scrollbar?: 'custom' | 'native'
}) {
  return (
    <MessageViewport
      runtime={runtime}
      renderMessage={(item) =>
        item.kind === 'committed' ? <span>{item.message.id}</span> : null
      }
      renderFollowBottom={renderFollowBottom}
      renderViewportOverlay={renderViewportOverlay}
      onViewportAnchorChanged={onViewportAnchorChanged}
      scrollbar={scrollbar}
      style={{ height: 240 }}
    />
  )
}

function layoutViewportRows(host: HTMLElement): void {
  const container = host.querySelector<HTMLElement>('[data-message-scroll-container]')

  if (container) {
    setElementMetrics(container, { top: 0, height: 240, width: 320 })
  }

  host.querySelectorAll<HTMLElement>('[data-message-row]').forEach((row, index) => {
    setElementMetrics(row, { top: index * 48, height: 48, width: 320 })
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

  it('reads snapshots from public hooks without sending projection commits', async () => {
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
      bottomLockState: 'LOCKED',
      bootstrapState: 'READY_EMPTY',
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
      notifyProjectionCommitted: vi.fn(),
    } as unknown as MessageViewportRuntime<TestMessage>

    function HookHarness() {
      const fullSnapshot = useMessageViewportSnapshot(runtime)
      const revision = useMessageViewportSelector(
        runtime,
        (nextSnapshot) => nextSnapshot.revision,
        Object.is,
      )

      return (
        <span data-testid="snapshot-hook-output">
          {fullSnapshot.feedId}:{revision}
        </span>
      )
    }

    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(<HookHarness />)
    })

    expect(host.textContent).toContain('feed:1')
    expect(runtime.notifyProjectionCommitted).not.toHaveBeenCalled()

    await act(async () => {
      snapshot = {
        ...snapshot,
        revision: 2,
      }
      for (const listener of listeners) {
        listener()
      }
    })

    expect(host.textContent).toContain('feed:2')
    expect(runtime.notifyProjectionCommitted).not.toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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

  it('hands off an optimistic row to its committed key through real React refs', async () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = new MessageViewportRuntime<TestMessage, TestDraft>({
      feedId: 'feed',
      generation: 1,
      scheduler,
      observers,
      window: {
        maxMountedItems: 20,
      },
    })
    const optimisticKey = {
      kind: 'optimistic' as const,
      clientMessageId: 'client-1',
    }
    const committedKey = {
      kind: 'committed' as const,
      messageId: 'm-1',
    }
    const initial: MessageDataSnapshot<TestMessage, TestDraft> = {
      feedId: 'feed',
      generation: 1,
      revision: 1,
      items: [
        {
          kind: 'optimistic',
          key: optimisticKey,
          draft: { id: 'client-1' },
          status: 'sending',
          version: 1,
          contentVersion: 1,
          estimatedHeight: 48,
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
      change: {
        kind: 'initial',
        viewportModifier: 'reset',
      },
    }
    const committed: MessageDataSnapshot<TestMessage, TestDraft> = {
      ...initial,
      revision: 2,
      items: [
        {
          kind: 'committed',
          key: committedKey,
          message: { id: 'm-1' },
          version: 1,
          contentVersion: 1,
          estimatedHeight: 48,
        },
      ],
      anchor: { messageId: 'm-1' },
      anchorStatus: 'normal',
      change: {
        kind: 'identityRebind',
        viewportModifier: 'identity-remap',
        identityRemaps: [
          {
            from: optimisticKey,
            to: committedKey,
          },
        ],
      },
    }
    const events: unknown[] = []
    const registerRow = vi.spyOn(runtime, 'registerRow')
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

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.setDataSnapshot(initial)
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })

    await act(async () => {
      root.render(
        <MessageViewport<TestMessage, TestDraft>
          runtime={runtime}
          renderMessage={(item) =>
            item.kind === 'optimistic'
              ? <span>{item.draft.id}</span>
              : item.kind === 'committed'
                ? <span>{item.message.id}</span>
                : null
          }
          style={{ height: 240 }}
        />,
      )
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    expect(
      host.querySelector('[data-testid="message-row-optimistic:client-1"]'),
    ).not.toBeNull()

    await act(async () => {
      runtime.setDataSnapshot(committed)
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    expect(
      host.querySelector('[data-testid="message-row-optimistic:client-1"]'),
    ).toBeNull()
    expect(
      host.querySelector('[data-testid="message-row-committed:m-1"]'),
    ).not.toBeNull()
    expect(registerRow).toHaveBeenCalledWith(optimisticKey, null)
    expect(registerRow).toHaveBeenCalledWith(committedKey, expect.any(HTMLDivElement))
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        feedId: 'feed',
        generation: 1,
      }),
    )
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'viewportError' }),
    )

    await act(async () => {
      root.unmount()
    })
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
    const onViewportAnchorChanged = vi.fn()
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
          onViewportAnchorChanged={onViewportAnchorChanged}
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
    expect(onViewportAnchorChanged).toHaveBeenCalled()
    expect(onViewportAnchorChanged.mock.calls.at(-1)?.[0]).toEqual(
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
          scrollbar="native"
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

  it('does not re-run edge slot renderers for non-edge snapshot updates', async () => {
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
      bottomLockState: 'LOCKED',
      bootstrapState: 'READY_EMPTY',
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
    const renderTopEdge = vi.fn((nextSnapshot: MessageViewportSnapshot) => (
      <div data-testid="top-edge">
        {nextSnapshot.edgeState.before}:{nextSnapshot.revision}
      </div>
    ))
    const renderBottomEdge = vi.fn((nextSnapshot: MessageViewportSnapshot) => (
      <div data-testid="bottom-edge">
        {nextSnapshot.edgeState.after}:{nextSnapshot.revision}
      </div>
    ))
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageViewport
          runtime={runtime}
          renderMessage={() => null}
          renderTopEdge={renderTopEdge}
          renderBottomEdge={renderBottomEdge}
          scrollbar="native"
        />,
      )
    })

    expect(renderTopEdge).toHaveBeenCalledTimes(1)
    expect(renderBottomEdge).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="top-edge"]')?.textContent).toBe(
      'idle:1',
    )

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

    expect(renderTopEdge).toHaveBeenCalledTimes(1)
    expect(renderBottomEdge).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="top-edge"]')?.textContent).toBe(
      'idle:1',
    )

    await act(async () => {
      snapshot = {
        ...snapshot,
        revision: 3,
        edgeState: {
          before: 'loading',
          after: 'idle',
        },
      }
      for (const listener of listeners) {
        listener()
      }
    })

    expect(renderTopEdge).toHaveBeenCalledTimes(2)
    expect(renderBottomEdge).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[data-testid="top-edge"]')?.textContent).toBe(
      'loading:3',
    )

    await act(async () => {
      root.unmount()
    })
  })

  it('uses explicit row render versions instead of volatile render prop identity', async () => {
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
    const snapshot: MessageViewportSnapshot<TestMessage> = {
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
    const renderCounts = new Map<string, number>()
    let rerenderShell: () => void = () => {
      throw new Error('rerenderShell not wired')
    }
    let setHighlightedMessage: (messageId: string | null) => void = () => {
      throw new Error('setHighlightedMessage not wired')
    }

    function Harness() {
      const [, setShellVersion] = useState(0)
      const [highlightedMessageId, setHighlightedMessageId] = useState<
        string | null
      >(null)

      useEffect(() => {
        rerenderShell = () => setShellVersion((version) => version + 1)
        setHighlightedMessage = setHighlightedMessageId
      }, [setHighlightedMessageId, setShellVersion])
      const getRowRenderVersion = useStableCallback(
        (item: MessageDataSnapshot<TestMessage>['items'][number]) =>
          item.kind === 'committed' &&
          item.message.id === highlightedMessageId
            ? `highlight:${item.message.id}`
            : 'normal',
      )

      return (
        <MessageViewport
          runtime={runtime}
          renderMessage={(item) => {
            if (item.kind !== 'committed') {
              return null
            }

            renderCounts.set(
              item.message.id,
              (renderCounts.get(item.message.id) ?? 0) + 1,
            )
            return (
              <span
                data-testid={`row-content-${item.message.id}`}
                data-highlighted={
                  highlightedMessageId === item.message.id ? 'true' : 'false'
                }
              >
                {item.message.id}
              </span>
            )
          }}
          getRowRenderVersion={getRowRenderVersion}
          scrollbar="native"
        />
      )
    }

    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(<Harness />)
    })

    expect(renderCounts.get('m-1')).toBe(1)
    expect(renderCounts.get('m-2')).toBe(1)

    await act(async () => {
      rerenderShell()
    })

    expect(renderCounts.get('m-1')).toBe(1)
    expect(renderCounts.get('m-2')).toBe(1)

    await act(async () => {
      setHighlightedMessage('m-2')
    })

    expect(renderCounts.get('m-1')).toBe(1)
    expect(renderCounts.get('m-2')).toBe(2)
    expect(
      host
        .querySelector('[data-testid="row-content-m-2"]')
        ?.getAttribute('data-highlighted'),
    ).toBe('true')

    await act(async () => {
      setHighlightedMessage(null)
    })

    expect(renderCounts.get('m-1')).toBe(1)
    expect(renderCounts.get('m-2')).toBe(3)

    await act(async () => {
      root.unmount()
    })
  })

  it('updates viewport overlays from observations without re-running row renderers', async () => {
    const runtimeListeners = new Set<() => void>()
    const runtimeEventListeners = new Set<
      (event: ViewportObservationChangedEvent) => void
    >()
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
    const snapshot: MessageViewportSnapshot<TestMessage> = {
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
      bottomLockState: 'LOCKED',
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
        runtimeListeners.add(listener)

        return () => {
          runtimeListeners.delete(listener)
        }
      },
      subscribeEvent: (
        listener: (event: ViewportObservationChangedEvent) => void,
      ) => {
        runtimeEventListeners.add(listener)

        return () => {
          runtimeEventListeners.delete(listener)
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
      beginDirectScroll: vi.fn(),
      writeDirectScrollTop: vi.fn(),
      endDirectScroll: vi.fn(),
      getViewportAnchorState: vi.fn(() => null),
      getDiagnosticRecords: vi.fn(() => []),
      getDebugSnapshot: vi.fn(),
    } as unknown as MessageViewportRuntime<TestMessage> & {
      dispatch: ReturnType<typeof vi.fn>
    }
    const renderCounts = new Map<string, number>()
    const renderViewportOverlay = vi.fn(({ observation, commands }) => (
      <button
        type="button"
        data-testid="viewport-overlay-follow"
        onClick={commands.followBottom}
      >
        {observation?.visibleRange.firstKey?.kind === 'committed'
          ? observation.visibleRange.firstKey.messageId
          : 'none'}
      </button>
    ))
    const host = document.createElement('div')
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <MessageViewport
          runtime={runtime}
          renderMessage={(item) => {
            if (item.kind !== 'committed') {
              return null
            }

            renderCounts.set(
              item.message.id,
              (renderCounts.get(item.message.id) ?? 0) + 1,
            )
            return <span>{item.message.id}</span>
          }}
          renderViewportOverlay={renderViewportOverlay}
          scrollbar="native"
        />,
      )
    })

    expect(renderCounts.get('m-1')).toBe(1)
    expect(renderCounts.get('m-2')).toBe(1)
    expect(host.querySelector('[data-testid="viewport-overlay-follow"]')?.textContent)
      .toBe('none')

    await act(async () => {
      const event: ViewportObservationChangedEvent = {
        type: 'viewportObservationChanged',
        feedId: 'feed',
        generation: 1,
        reason: 'scroll-frame',
        scrollSource: 'user',
        direction: 'down',
        activity: {
          phase: 'scrolling',
          direction: 'down',
        },
        anchor: null,
        visibleRange: {
          firstKey: itemA.key,
          lastKey: itemB.key,
        },
        visibleItems: [
          { key: itemA.key, visibleRatio: 1 },
          { key: itemB.key, visibleRatio: 0.5 },
        ],
      }

      for (const listener of runtimeEventListeners) {
        listener(event)
      }
    })

    expect(host.querySelector('[data-testid="viewport-overlay-follow"]')?.textContent)
      .toBe('m-1')
    expect(renderCounts.get('m-1')).toBe(1)
    expect(renderCounts.get('m-2')).toBe(1)

    await act(async () => {
      host.querySelector<HTMLButtonElement>(
        '[data-testid="viewport-overlay-follow"]',
      )?.click()
    })

    expect(runtime.dispatch).toHaveBeenCalledWith({ type: 'followBottom' })

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
    const onViewportAnchorChanged = vi.fn()

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
          onViewportAnchorChanged={onViewportAnchorChanged}
        />,
      )
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    expect(host.textContent).toContain('a-')
    layoutViewportRows(host)
    onViewportAnchorChanged.mockClear()
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
          onViewportAnchorChanged={onViewportAnchorChanged}
        />,
      )
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    expect(detachDomSnapshots[0]).toContain('a-')
    expect(detachDomSnapshots[0]).not.toContain('b-')
    expect(onViewportAnchorChanged).toHaveBeenCalledWith(
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
    const onViewportAnchorChanged = vi.fn()

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
          onViewportAnchorChanged={onViewportAnchorChanged}
        />,
      )
    })
    await act(async () => {
      await flushFramesWithMicrotasks(scheduler, 4)
    })

    layoutViewportRows(host)
    onViewportAnchorChanged.mockClear()

    await act(async () => {
      root.unmount()
    })

    expect(onViewportAnchorChanged).toHaveBeenCalledWith(
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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

    expect(document.head.textContent).toContain('scrollbar-width: none')
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
        <ViewportOnlyHarness runtime={runtime} scrollbar="native" />,
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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
      root.render(<ViewportOnlyHarness runtime={runtime} scrollbar="custom" />)
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
