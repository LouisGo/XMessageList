import type { RuntimeNextDiagnosticRecord } from '../diagnostics/types'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeDataStore } from '../data/store'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type {
  PhysicalSegmentRevisionController,
} from '../geometry/segment/segmentRevision'
import type { ProjectionStore } from '../projection/store'
import type { ScrollWriterArbitration, ScrollWriterToken } from '../scroll/writerArbitration'
import type { RuntimeTransaction, RuntimeTransactionIntent } from '../transactions/types'
import type { PendingDataIntent } from '../data/classifier.types'
import type { PendingGeometryProjection } from '../geometry/publication/publication.types'
import type { GeometryBuildPlan } from '../transactions/geometryBuilder.types'
import type { BottomLockState, BootstrapState, ViewportPhase } from '../projection/types'
import type { PhysicalScrollMetrics } from '../geometry/types'

export type PendingPublicationState<TMessage = unknown, TOptimistic = unknown> = {
  readonly transaction: RuntimeTransaction<TMessage, TOptimistic>
  readonly plan: GeometryBuildPlan<TMessage, TOptimistic>
  readonly publication: PendingGeometryProjection<TMessage, TOptimistic>
  readonly writerToken: ScrollWriterToken | null
  readonly desiredScrollTop: number | null
  readonly promotesBottomLock: boolean
}

export type RuntimeControllerRuntimeState = {
  readonly bootstrapState: BootstrapState
  readonly viewportPhase: ViewportPhase
  readonly bottomLockState: BottomLockState
}

export type RuntimeControllerEnvironment<TMessage = unknown, TOptimistic = unknown> = {
  readonly dom: RuntimeDomRegistry
  readonly data: RuntimeDataStore<TMessage, TOptimistic>
  readonly projection: ProjectionStore<TMessage, TOptimistic>
  readonly metrics: PhysicalMetricsStore
  readonly revisionController: PhysicalSegmentRevisionController
  readonly writer: ScrollWriterArbitration
}

export type RuntimeControllerStores = {
  readonly diagnostics: RuntimeNextDiagnosticRecord[]
}

export type RuntimeControllerIntentState<TMessage = unknown, TOptimistic = unknown> = {
  readonly pendingBootstrap: RuntimeTransactionIntent<TMessage, TOptimistic> | null
  readonly pendingDataIntent: PendingDataIntent | null
}

export type RuntimeControllerMetricsState = PhysicalScrollMetrics
