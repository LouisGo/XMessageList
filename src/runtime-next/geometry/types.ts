import type {
  RuntimeNextFeedId,
  RuntimeNextGeneration,
  RuntimeNextRevision,
  RuntimeNextSegmentId,
} from '../types'

export type PhysicalScrollRange = {
  readonly min: number
  readonly max: number
}

export type PhysicalSegmentCapMode =
  | 'normal'
  | 'short-feed'
  | 'exceptional-row'

export type PhysicalScrollMetrics = {
  readonly feedId: RuntimeNextFeedId
  readonly generation: RuntimeNextGeneration
  readonly segmentId: RuntimeNextSegmentId
  readonly segmentRevision: RuntimeNextRevision
  readonly physicalWindowHeight: number
  readonly viewportHeight: number
  readonly scrollTop: number
  readonly safeScrollRange: PhysicalScrollRange
  readonly rowCoverage: 'unknown' | 'covered' | 'insufficient'
  readonly capMode: PhysicalSegmentCapMode
}

