import type { PhysicalScrollMetrics } from './types'

export function createInitialPhysicalScrollMetrics(input: {
  readonly feedId: string
  readonly generation: number
}): PhysicalScrollMetrics {
  // P2 不提交真实 physical segment；零值 metrics 只表达订阅合同的初始形态。
  return {
    feedId: input.feedId,
    generation: input.generation,
    segmentId: 'p2-contract-placeholder',
    segmentRevision: 0,
    physicalWindowHeight: 0,
    viewportHeight: 0,
    scrollTop: 0,
    safeScrollRange: {
      min: 0,
      max: 0,
    },
    rowCoverage: 'unknown',
    capMode: 'normal',
  }
}

