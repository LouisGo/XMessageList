import type { MessageDataSnapshot } from '../data/types'
import type { PhysicalScrollMetrics, SegmentShiftDirection } from '../geometry/types'

export type EdgeNeedRequest = {
  readonly direction: SegmentShiftDirection
  readonly reason: 'near-top' | 'near-bottom'
}

export class EdgeNeedLatch {
  readonly #emittedKeys = new Set<string>()

  shouldEmit(input: {
    readonly feedId: string
    readonly generation: number
    readonly dataRevision: number
    readonly metrics: PhysicalScrollMetrics
    readonly direction: SegmentShiftDirection
  }): boolean {
    if (input.metrics.physicalSegmentId === null) return false

    const key = [
      input.feedId,
      input.generation,
      input.dataRevision,
      input.metrics.physicalSegmentId,
      input.metrics.physicalSegmentRevision,
      input.direction,
    ].join(':')

    if (this.#emittedKeys.has(key)) return false
    this.#emittedKeys.add(key)

    return true
  }

  clear(): void {
    this.#emittedKeys.clear()
  }
}

export function resolveEdgeNeedRequest(input: {
  readonly snapshot: MessageDataSnapshot
  readonly metrics: PhysicalScrollMetrics
  readonly prefetchBandPx?: number
}): EdgeNeedRequest | null {
  const metrics = input.metrics
  if (metrics.physicalSegmentId === null || metrics.isSegmentShifting) {
    return null
  }
  const prefetchBandPx = Math.max(
    0,
    input.prefetchBandPx ?? metrics.viewportSize * 1.5,
  )

  if (
    input.snapshot.hasMoreBefore &&
    metrics.scrollPosition <= metrics.safeScrollRangeStart + prefetchBandPx
  ) {
    return {
      direction: 'before',
      reason: 'near-top',
    }
  }

  if (
    input.snapshot.hasMoreAfter &&
    metrics.scrollPosition >= metrics.safeScrollRangeEnd - prefetchBandPx
  ) {
    return {
      direction: 'after',
      reason: 'near-bottom',
    }
  }

  return null
}
