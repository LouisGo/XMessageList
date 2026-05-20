import type { PhysicalScrollMetrics } from './types'
import type { ProjectionCommitToken, ProjectionRow } from '../projection/types'

export type GeometryPublication<TPayload = unknown> = {
  readonly commitToken: ProjectionCommitToken
  readonly rows: readonly ProjectionRow<TPayload>[]
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly physicalWindowHeight: number
  readonly metrics: PhysicalScrollMetrics
}

