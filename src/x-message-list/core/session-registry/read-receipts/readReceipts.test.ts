import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageListAdapter } from '../contracts'
import { MessageListReadReceiptsWorker } from './readReceipts'

type Row = { id: string }

function createWorker(markRead: (rows: Row[]) => void | Promise<void>) {
  const row = { id: 'row-1' }
  const adapter = {
    row: {
      getKey: (value: Row) => value.id,
    },
    readReceipts: {
      batchDelayMs: 0,
      markRead,
    },
  } as MessageListAdapter<Row, { id: string }>
  const worker = new MessageListReadReceiptsWorker(
    adapter,
    () => [row],
  )
  return { row, worker }
}

function observe(worker: MessageListReadReceiptsWorker<Row, { id: string }>) {
  worker.handleObservation({
    type: 'viewportObservationChanged',
    sessionId: 'session-1',
    generation: 1,
    segmentRevision: 1,
    reason: 'scroll-idle',
    scrollSource: 'user',
    direction: 'none',
    activity: 'scrolling',
    visibleKeys: ['row-1'],
    visibleRange: { firstKey: 'row-1', lastKey: 'row-1' },
    visibleItems: [{ key: 'row-1', visibleRatio: 1 }],
    anchor: null,
    distanceToBottom: 0,
  })
}

describe('MessageListReadReceiptsWorker scheduling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps the global receiver when requestIdleCallback brand-checks it', async () => {
    vi.useFakeTimers()
    const markRead = vi.fn()
    const requestIdleCallback = vi.fn(function (
      this: typeof globalThis,
      callback: IdleRequestCallback,
    ) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      callback({ didTimeout: false, timeRemaining: () => 50 })
      return 1
    })
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    const { worker } = createWorker(markRead)

    observe(worker)
    await vi.advanceTimersByTimeAsync(0)

    expect(requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(markRead).toHaveBeenCalledWith([{ id: 'row-1' }])
  })

  it('falls back to a microtask when idle scheduling throws', async () => {
    vi.useFakeTimers()
    const markRead = vi.fn()
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn(() => {
        throw new TypeError('Illegal invocation')
      }),
    )
    const { worker } = createWorker(markRead)

    observe(worker)
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()

    expect(markRead).toHaveBeenCalledWith([{ id: 'row-1' }])
  })
})
