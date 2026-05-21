import type { RuntimeDataStore } from '../data/store'
import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type { PhysicalScrollMetrics } from '../geometry/types'
import type { PendingGeometryProjection } from '../geometry/publication/publication.types'
import type {
  PhysicalSegmentRevisionController,
} from '../geometry/segment/segmentRevision'
import type { AnchorState } from '../identity/types'
import type { ProjectionStore } from '../projection/store'
import type { BottomLockState, MessageViewportSnapshot } from '../projection/types'
import type { ScrollMotionEngine } from '../scroll/motionEngine'
import type { ScrollWriterArbitration } from '../scroll/writerArbitration'
import type { GeometryBuildPlan } from '../transactions/geometryBuilder.types'
import type { TransactionRunner } from '../transactions/transactionRunner'
import type {
  RuntimeTransaction,
  RuntimeTransactionIntent,
  TransactionAbortReason,
} from '../transactions/types'
import type { PendingDataIntent } from '../data/classifier.types'

export type PendingPublication<TMessage, TOptimistic> = {
  readonly transaction: RuntimeTransaction<TMessage, TOptimistic>
  readonly plan: GeometryBuildPlan<TMessage, TOptimistic>
  readonly publication: PendingGeometryProjection<TMessage, TOptimistic>
  readonly promotesBottomLock: boolean
  readonly phase: 'initial' | 'correction'
  readonly stableSnapshot: MessageViewportSnapshot<TMessage, TOptimistic>
  readonly measuredRowsHeight?: number
  readonly measuredRowHeights?: ReadonlyMap<string, number>
}

export type RuntimeTransactionFlowContext<TMessage, TOptimistic> = {
  readonly data: RuntimeDataStore<TMessage, TOptimistic>
  readonly dom: RuntimeDomRegistry
  readonly projection: ProjectionStore<TMessage, TOptimistic>
  readonly metrics: PhysicalMetricsStore
  readonly revision: PhysicalSegmentRevisionController
  readonly writer: ScrollWriterArbitration
  readonly motion: ScrollMotionEngine
  readonly runner: TransactionRunner<TMessage, TOptimistic>
  readonly diagnostics: DiagnosticRecorder
  readonly getBottomLockState: () => BottomLockState
  readonly setBottomLockState: (state: BottomLockState) => void
  readonly getCurrentScrollTop: () => number
  readonly setCurrentScrollTop: (scrollTop: number) => void
  readonly resolveScrollFlagsForPromotion: (
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
  ) => Partial<PhysicalScrollMetrics>
  readonly armAckTimeout: (transactionId: string) => void
  readonly clearAckTimeout: () => void
  readonly enqueue: (intent: RuntimeTransactionIntent<TMessage, TOptimistic>) => void
  readonly finish: (transactionId: string) => void
  readonly abort: (reason: TransactionAbortReason) => void
  readonly recoverRelayoutBounds: (target: AnchorState) => void
  readonly deferPendingDataIntent: (intent: PendingDataIntent) => void
}
