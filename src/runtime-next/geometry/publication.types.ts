import type { PhysicalScrollMetrics } from './types'
import type {
  MessageDataItem,
  ProjectionCommitToken,
  RenderWindow,
} from '../projection/types'

export type GeometryPublication<TMessage = unknown, TOptimistic = unknown> = {
  readonly commitToken: ProjectionCommitToken
  readonly items: readonly MessageDataItem<TMessage, TOptimistic>[]
  readonly renderWindow: RenderWindow
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly physicalWindowHeight: number
  readonly metrics: PhysicalScrollMetrics
}
