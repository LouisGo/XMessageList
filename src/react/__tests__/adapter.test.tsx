import { StrictMode, act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  MessageViewport,
  MessageViewportRuntime,
  type MessageDataSnapshot,
} from '../..'
import { FakeScheduler, createFakeObservers } from '../../test/fakes'

type TestMessage = {
  id: string
}

function createSnapshot(input?: {
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
}): MessageDataSnapshot<TestMessage> {
  return {
    feedId: 'feed',
    generation: 1,
    revision: 1,
    items: Array.from({ length: 12 }, (_, index) => ({
      kind: 'committed' as const,
      key: { kind: 'committed' as const, messageId: `m-${index}` },
      message: { id: `m-${index}` },
      version: 1,
      contentVersion: 1,
      estimatedHeight: 48,
    })),
    anchor: { messageId: 'm-11' },
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
        minMountedItems: 8,
        maxMountedItems: 20,
        defaultItemHeight: 48,
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
    expect(host.querySelectorAll('[data-message-row]').length).toBeGreaterThan(0)

    await act(async () => {
      root.unmount()
    })

    expect(runtime.getDebugSnapshot().state).toBe('DETACHED')
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
        minMountedItems: 8,
        maxMountedItems: 20,
        defaultItemHeight: 48,
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
    expect(onViewportAnchorChange.mock.calls.at(-1)?.[1]).toBe(
      'transaction-settle',
    )

    await act(async () => {
      followButton?.click()
    })

    expect(dispatch).toHaveBeenCalledWith({ type: 'followBottom' })
    await act(async () => {
      root.unmount()
    })
  })
})
