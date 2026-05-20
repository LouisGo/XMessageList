import type { PhysicalScrollMetrics } from '../types'
import type { PhysicalSegment } from '../segment/physicalSegment.types'
import type {
  MessageDataItem,
  ProjectionCommitToken,
  RenderWindow,
} from '../../projection/types'

export type PendingGeometryProjection<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  readonly commitToken: ProjectionCommitToken
  readonly segment: PhysicalSegment
  readonly items: readonly MessageDataItem<TMessage, TOptimistic>[]
  readonly renderWindow: RenderWindow
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly naturalBlankHeight: number
  readonly physicalWindowHeight: number
  readonly mountedRowsHeightEstimate: number
}

export type CommittedGeometryPublication<
  TMessage = unknown,
  TOptimistic = unknown,
> = PendingGeometryProjection<TMessage, TOptimistic> & {
  readonly metrics: PhysicalScrollMetrics
}

export type GeometryPublication<
  TMessage = unknown,
  TOptimistic = unknown,
> = PendingGeometryProjection<TMessage, TOptimistic>
