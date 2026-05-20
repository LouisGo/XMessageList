import type { PhysicalScrollMetrics } from '../types'

export function createInitialPhysicalScrollMetrics(input: {
  readonly feedId: string
  readonly generation: number
}): PhysicalScrollMetrics {
  void input

  // P2 不提交真实 physical segment；零值 metrics 只表达订阅合同的初始形态。
  return {
    physicalSegmentId: null,
    physicalSegmentRevision: 0,
    viewportSize: 0,
    physicalWindowSize: 0,
    domScrollHeight: 0,
    scrollPosition: 0,
    maxScrollPosition: 0,
    scrollHeightCap: 0,
    capMode: 'normal',
    safeScrollRangeStart: 0,
    safeScrollRangeEnd: 0,
    isDragLocked: false,
    isThumbFrozen: false,
    isSegmentShiftPending: false,
    pendingShiftDirection: null,
    pendingEdgeOverflowPx: 0,
    isSegmentShifting: false,
    isMomentumLatched: false,
    suppressedMomentumDeltaPx: 0,
    segmentRelayoutState: 'idle',
    segmentRelayoutReason: null,
    adjacentPrefetchBefore: 'idle',
    adjacentPrefetchAfter: 'idle',
  }
}
