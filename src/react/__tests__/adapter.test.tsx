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

function createSnapshot(): MessageDataSnapshot<TestMessage> {
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
    hasMoreBefore: false,
    hasMoreAfter: false,
    change: {
      kind: 'initial',
      viewportEffect: 'reset',
    },
  }
}

function TestHarness({
  runtime,
}: {
  runtime: MessageViewportRuntime<TestMessage>
}) {
  useEffect(() => {
    runtime.setDataSnapshot(createSnapshot())
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
  }, [runtime])

  return (
    <MessageViewport
      runtime={runtime}
      renderMessage={(item) =>
        item.kind === 'committed' ? <span>{item.message.id}</span> : null
      }
      style={{ height: 240 }}
    />
  )
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
      scheduler.flushFrames(3)
    })

    expect(notify).toHaveBeenCalled()
    expect(host.querySelector('[data-message-viewport]')).not.toBeNull()
    expect(host.querySelectorAll('[data-message-row]').length).toBeGreaterThan(0)

    await act(async () => {
      root.unmount()
    })

    expect(runtime.getDebugSnapshot().state).toBe('DETACHED')
  })
})
