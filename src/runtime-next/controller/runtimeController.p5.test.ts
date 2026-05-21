import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContainer } from '../../test/fakes'
import { MessageViewportRuntime } from '../MessageViewportRuntime'
import type { MessageDataItem, ProjectionCommitToken } from '../types'

function item(messageId: string, estimatedHeight = 400): MessageDataItem<{ text: string }> {
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
}) {
  return {
    feedId: 'feed',
    generation: 1,
    revision: input.revision ?? 1,
    items: input.items,
    hasMoreBefore: input.hasMoreBefore ?? false,
    hasMoreAfter: input.hasMoreAfter ?? false,
    change: {
      kind: 'initial' as const,
      viewportModifier: 'none' as const,
    },
  }
}

function commit(runtime: MessageViewportRuntime<{ text: string }>): ProjectionCommitToken {
  const token = runtime.getSnapshot().commitToken
  runtime.notifyProjectionCommitted(token)

  return token
}

afterEach(() => {
  vi.useRealTimers()
})

describe('runtime-next P5 input, scrollbar, and motion integration', () => {
  it('promotes first followBottom without a previously committed segment', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1', 250), item('m-2', 250)],
    }))

    runtime.dispatch({ type: 'followBottom' })
    const token = runtime.getSnapshot().commitToken
    expect(runtime.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(0)
    runtime.notifyProjectionCommitted(token)

    const metrics = runtime.getPhysicalScrollMetrics()
    expect(metrics.physicalSegmentId).toBe(token.segmentId)
    expect(metrics.physicalSegmentRevision).toBe(token.segmentRevision)
    expect(container.scrollTop).toBe(metrics.maxScrollPosition)
    expect(metrics.scrollPosition).toBe(metrics.maxScrollPosition)
  })

  it('does not expose motion scrollPosition before metrics promotion', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 4 }, (_, index) => item(`m-${index + 1}`, 250)),
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    runtime.writeDirectScrollTop(0, { source: 'custom-scrollbar-track' })
    const stableRevision = runtime.getPhysicalScrollMetrics().physicalSegmentRevision
    const emissions: number[] = []
    runtime.subscribePhysicalScroll(() => {
      emissions.push(runtime.getPhysicalScrollMetrics().physicalSegmentRevision)
    })

    runtime.dispatch({ type: 'followBottom' })
    const token = runtime.getSnapshot().commitToken
    expect(runtime.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(
      stableRevision,
    )
    runtime.notifyProjectionCommitted(token)

    expect(emissions[0]).toBe(token.segmentRevision)
    expect(emissions).not.toContain(stableRevision)
    expect(runtime.getPhysicalScrollMetrics().scrollPosition).toBe(
      runtime.getPhysicalScrollMetrics().maxScrollPosition,
    )
  })

  it('reconciles bottom lock immediately after direct scroll writes', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 200 }))
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`, 250)),
    }))
    runtime.dispatch({ type: 'followBottom' })
    commit(runtime)
    const metricsBeforeScroll = runtime.getPhysicalScrollMetrics()
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')

    expect(runtime.writeDirectScrollTop(metricsBeforeScroll.safeScrollRangeStart, {
      source: 'custom-scrollbar-track',
    })).toBe(true)

    expect(runtime.getPhysicalScrollMetrics().scrollPosition).toBe(
      metricsBeforeScroll.safeScrollRangeStart,
    )
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
  })

  it('runs drag segment handoff with thumb freeze and continuation rebase', () => {
    vi.useFakeTimers()
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`)),
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    const stableSegmentId = runtime.getPhysicalScrollMetrics().physicalSegmentId

    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
    const acceptedWrite = runtime.writeDirectScrollTop(-9999, {
      source: 'custom-scrollbar-drag',
    })

    expect(acceptedWrite).toBe(false)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        isDragLocked: true,
        isThumbFrozen: true,
        isSegmentShiftPending: true,
        isSegmentShifting: true,
        pendingShiftDirection: 'before',
      }),
    )
    expect(runtime.getPhysicalScrollMetrics().physicalSegmentId).toBe(
      stableSegmentId,
    )

    const handoffToken = runtime.getSnapshot().commitToken
    runtime.notifyProjectionCommitted(handoffToken)

    const metrics = runtime.getPhysicalScrollMetrics()
    expect(metrics.physicalSegmentId).toBe(handoffToken.segmentId)
    expect(metrics.isDragLocked).toBe(true)
    expect(metrics.isThumbFrozen).toBe(true)
    expect(metrics.isSegmentShiftPending).toBe(true)
    expect(metrics.isSegmentShifting).toBe(true)
    expect(metrics.scrollPosition).toBeGreaterThanOrEqual(
      metrics.safeScrollRangeStart,
    )
    expect(metrics.scrollPosition).toBeLessThanOrEqual(
      metrics.safeScrollRangeEnd,
    )

    vi.advanceTimersByTime(20)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        isDragLocked: true,
        isThumbFrozen: false,
        isSegmentShiftPending: false,
        isSegmentShifting: false,
      }),
    )
    runtime.endDirectScroll({ source: 'custom-scrollbar-drag' })
    expect(runtime.getPhysicalScrollMetrics().isDragLocked).toBe(false)
    vi.useRealTimers()
  })

  it('keeps drag writer ownership before handoff settle frame', () => {
    vi.useFakeTimers()
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 320 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`)),
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
    expect(runtime.writeDirectScrollTop(-9999, {
      source: 'custom-scrollbar-drag',
    })).toBe(false)
    runtime.dispatch({ type: 'followBottom' })

    const handoffToken = runtime.getSnapshot().commitToken
    runtime.notifyProjectionCommitted(handoffToken)
    const scrollTopAfterHandoff = container.scrollTop
    expect(runtime.getPhysicalScrollMetrics().isThumbFrozen).toBe(true)

    const queuedFollowToken = runtime.getSnapshot().commitToken
    expect(queuedFollowToken.transactionId).not.toBe(handoffToken.transactionId)
    runtime.notifyProjectionCommitted(queuedFollowToken)

    expect(container.scrollTop).toBe(scrollTopAfterHandoff)
    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.message === 'transaction writer denied' &&
        record.details?.reason === 'active-drag',
      ),
    ).toBe(true)

    vi.advanceTimersByTime(20)
    runtime.endDirectScroll({ source: 'custom-scrollbar-drag' })
  })

  it('keeps drag at the safe edge and emits need when handoff data is missing', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const events: string[] = []
    runtime.subscribeEvent((event) => events.push(event.type))
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2'), item('m-3')],
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
    expect(runtime.writeDirectScrollTop(-9999, {
      source: 'custom-scrollbar-drag',
    })).toBe(true)

    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        isThumbFrozen: false,
        isSegmentShiftPending: true,
        pendingShiftDirection: 'before',
      }),
    )
    expect(events).toContain('needMoreBefore')
  })

  it('latches wheel momentum at a segment edge and suppresses residual delta', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 320 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`)),
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    const firstWheel = new WheelEvent('wheel', {
      deltaY: -120,
      cancelable: true,
    })
    const residualWheel = new WheelEvent('wheel', {
      deltaY: -80,
      cancelable: true,
    })
    container.dispatchEvent(firstWheel)
    container.dispatchEvent(residualWheel)

    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        isMomentumLatched: true,
        pendingShiftDirection: 'before',
        suppressedMomentumDeltaPx: 200,
      }),
    )
    expect(firstWheel.defaultPrevented).toBe(true)
    expect(residualWheel.defaultPrevented).toBe(true)
    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.message === 'scroll.momentum.suppressDelta',
      ),
    ).toBe(true)
  })

  it('suppresses same-direction wheel residual before latch settle frame', () => {
    vi.useFakeTimers()
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 320 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`)),
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    const firstWheel = new WheelEvent('wheel', {
      deltaY: -120,
      cancelable: true,
    })
    container.dispatchEvent(firstWheel)
    runtime.notifyProjectionCommitted(runtime.getSnapshot().commitToken)

    const residualAfterCommit = new WheelEvent('wheel', {
      deltaY: -80,
      cancelable: true,
    })
    container.dispatchEvent(residualAfterCommit)

    expect(firstWheel.defaultPrevented).toBe(true)
    expect(residualAfterCommit.defaultPrevented).toBe(true)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        isMomentumLatched: true,
        suppressedMomentumDeltaPx: 200,
      }),
    )

    vi.advanceTimersByTime(20)
    expect(runtime.getPhysicalScrollMetrics().isMomentumLatched).toBe(false)
  })

  it('releases wheel momentum latch after scrolling back inside the safe range', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 320 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) => item(`m-${index + 1}`)),
      hasMoreBefore: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    container.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120,
      cancelable: true,
    }))
    const reverseWheel = new WheelEvent('wheel', {
      deltaY: 80,
      cancelable: true,
    })
    container.dispatchEvent(reverseWheel)

    expect(reverseWheel.defaultPrevented).toBe(false)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        isMomentumLatched: false,
        suppressedMomentumDeltaPx: 0,
      }),
    )
  })
})
