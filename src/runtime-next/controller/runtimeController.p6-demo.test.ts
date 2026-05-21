import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContainer, setElementMetrics } from '../../test/fakes'
import { MessageViewportRuntime } from '../MessageViewportRuntime'
import type { AnchorState, MessageDataItem, ProjectionCommitToken } from '../types'
import { MessageViewportRuntimeController } from './runtimeController'

function item(messageId: string, estimatedHeight = 250): MessageDataItem<{ text: string }> {
  return {
    kind: 'committed',
    key: {
      kind: 'committed',
      messageId,
    },
    message: {
      text: messageId,
    },
    version: 1,
    estimatedHeight,
  }
}

function snapshot(input: {
  readonly items: readonly MessageDataItem<{ text: string }>[]
  readonly hasMoreBefore?: boolean
  readonly hasMoreAfter?: boolean
  readonly revision?: number
  readonly modifier?: 'none' | 'reset' | 'prepend' | 'append'
}) {
  return {
    feedId: 'feed',
    generation: 1,
    revision: input.revision ?? 1,
    items: input.items,
    hasMoreBefore: input.hasMoreBefore ?? false,
    hasMoreAfter: input.hasMoreAfter ?? false,
    change: {
      kind: input.modifier === 'prepend'
        ? 'prepend' as const
        : input.modifier === 'append'
          ? 'append' as const
          : 'initial' as const,
      viewportModifier: input.modifier ?? 'none',
    },
  }
}

function commit(runtime: {
  readonly getSnapshot: () => { readonly commitToken: ProjectionCommitToken }
  readonly notifyProjectionCommitted: (token: ProjectionCommitToken) => void
}): ProjectionCommitToken {
  const token = runtime.getSnapshot().commitToken
  runtime.notifyProjectionCommitted(token)

  return token
}

function row(height: number): HTMLElement {
  const element = document.createElement('div')
  setElementMetrics(element, { top: 0, height })

  return element
}

afterEach(() => {
  vi.useRealTimers()
})

describe('runtime-next P6 demo bootstrap behavior', () => {
  it('commits latest bootstrap at the physical bottom', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`)),
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    const pendingToken = runtime.getSnapshot().commitToken

    expect(runtime.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(0)
    expect(runtime.getSnapshot().topSpacer).toBeGreaterThan(0)
    expect(runtime.getSnapshot().bottomSpacer).toBe(0)
    runtime.notifyProjectionCommitted(pendingToken)

    const metrics = runtime.getPhysicalScrollMetrics()
    expect(metrics.physicalSegmentId).toBe(pendingToken.segmentId)
    expect(metrics.scrollPosition).toBe(metrics.maxScrollPosition)
    expect(container.scrollTop).toBe(metrics.maxScrollPosition)
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
  })

  it('does not emit history need from the first latest bottom scroll frame', () => {
    vi.useFakeTimers()
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const events: string[] = []
    const container = createContainer({ height: 200 })
    runtime.subscribeEvent((event) => events.push(event.type))
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`)),
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(20)

    expect(events).not.toContain('needMoreBefore')
  })

  it('clamps native scroll frames out of spacer-only space', () => {
    vi.useFakeTimers()
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`)),
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    const safeStart = runtime.getPhysicalScrollMetrics().safeScrollRangeStart

    container.scrollTop = 0
    container.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(20)

    expect(container.scrollTop).toBe(safeStart)
    expect(runtime.getPhysicalScrollMetrics().scrollPosition).toBe(safeStart)
  })

  it('does not requeue an identical segment relayout forever', () => {
    const runtime = new MessageViewportRuntimeController<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    const items = Array.from({ length: 5 }, (_, index) => item(`m-${index + 1}`, 100))
    const target: AnchorState = {
      key: items[2]!.key,
      offsetWithinMessage: 0,
    }
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items,
      hasMoreBefore: true,
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'restored', target })
    commit(runtime)
    const stableToken = runtime.getSnapshot().commitToken

    runtime.enqueueInternalTransaction({ kind: 'segmentRelayout', reason: 'coverage-risk' })
    const relayoutToken = runtime.getSnapshot().commitToken
    const measuredKey = runtime.getSnapshot().renderWindow.itemKeys[0]
    expect(measuredKey).toBeDefined()
    runtime.registerRow(measuredKey!, row(1200))
    runtime.notifyProjectionCommitted(relayoutToken)

    expect(runtime.getSnapshot().commitToken).toEqual(stableToken)
    expect(
      runtime.getDiagnosticRecords().filter((record) =>
        record.message === 'segmentRelayout self-loop suppressed'),
    ).toHaveLength(1)
  })
})
