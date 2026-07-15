import type { LoadedSegment } from '../contracts/segment'
import type { ViewportDiagnosticRecord } from '../contracts/events'
import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { RuntimeDirtyRangeRegistry } from '../dom/dirtyRange'
import type { RuntimeInteractionState } from '../interactions/interactionState'
import { withNextProjectionRevision } from '../shared/snapshotIdentity'
import type { RuntimeScheduler } from '../contracts/options'
import { resolveProjectionTransactionPolicy, shouldPreservePendingIntentForSegment, type PendingTransaction, type ProjectionStage } from './controllerTransactionHelpers'
import type { ProjectionTransactionQueue } from './transactionQueue'

export type ProjectionTransactionHost<TMessage, TOptimistic> = {
  sessionId: string
  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic>
  interactions: RuntimeInteractionState<TMessage, TOptimistic>
  transactions: ProjectionTransactionQueue<TMessage, TOptimistic>
  scheduler: RuntimeScheduler
  isMotionActive(): boolean
  rejectAfterDestroy(operation: string): boolean
  cancelPendingRuntimeMotion(): void
  resetSnapshot(snapshot: MessageListSnapshot<TMessage, TOptimistic>): void
  syncScrollIntentBottomLock(): void
  startTransaction(segment: LoadedSegment<TMessage, TOptimistic>, stage?: ProjectionStage): void
  pushDiagnostic(
    name: string,
    severity: ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ): void
  rollbackStagedTransaction(pending: PendingTransaction<TMessage, TOptimistic>): void
  applySettledTransactionContinuations(options: { evaluatePostCommitInteractions?: boolean }): void
}

/**
 * Normal source publications may supersede older work, while staged reloads
 * deliberately wait. Keeping both entry rules together prevents a future
 * reload path from accidentally taking the destructive publication route.
 */
export function applyLoadedProjectionTransaction<TMessage, TOptimistic>(
  host: ProjectionTransactionHost<TMessage, TOptimistic>,
  segment: LoadedSegment<TMessage, TOptimistic>,
): void {
  if (host.rejectAfterDestroy('applyLoadedSegment')) return
  if (segment.sessionId !== host.sessionId) {
    host.pushDiagnostic('transaction.wrongSessionSegment', 'error', {
      runtimeSessionId: host.sessionId,
      segmentSessionId: segment.sessionId,
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
    })
    return
  }
  if (!host.interactions.acceptsDestinationSegment(segment)) {
    host.pushDiagnostic('destination.staleSegment', 'warn', {
      sessionId: segment.sessionId,
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      requestToken: segment.modifier.type === 'reset-around'
        ? segment.modifier.requestToken
        : undefined,
    })
    return
  }
  const snapshot = host.getSnapshot()
  const policy = resolveProjectionTransactionPolicy(
    segment,
    snapshot,
    host.interactions.hasActiveFollowBottom(snapshot),
  )
  if (host.transactions.isStaleSegment(segment, snapshot)) {
    host.pushDiagnostic('transaction.staleSegment', 'warn', {
      segmentGeneration: segment.generation,
      currentGeneration: snapshot.generation,
      segmentRevision: segment.segmentRevision,
      currentSegmentRevision: snapshot.segmentRevision,
    })
    return
  }
  cancelTransactionsBeforeGeneration(host, segment)
  if (host.transactions.shouldQueue() || (host.isMotionActive() && policy.queueDuringMotion)) {
    const queued = host.transactions.enqueue(segment, policy)
    host.pushDiagnostic('transaction.queued', 'info', {
      sessionId: segment.sessionId,
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      lane: policy.lane,
      queueLength: queued.queueLength,
      dropped: queued.dropped,
    })
    return
  }
  host.startTransaction(segment)
}

/**
 * A staged projection has no authority to interrupt current work. It becomes
 * authoritative only when its DOM commit reaches the stage's CAS gate.
 */
export function stageLoadedProjectionTransaction<TMessage, TOptimistic>(
  host: ProjectionTransactionHost<TMessage, TOptimistic>,
  segment: LoadedSegment<TMessage, TOptimistic>,
  stage: ProjectionStage,
): boolean {
  if (host.rejectAfterDestroy('stageLoadedSegment')) return false
  const snapshot = host.getSnapshot()
  if (segment.sessionId !== host.sessionId || host.transactions.isStaleSegment(segment, snapshot)) {
    return false
  }
  const policy = resolveProjectionTransactionPolicy(
    segment,
    snapshot,
    host.interactions.hasActiveFollowBottom(snapshot),
  )
  if (host.transactions.shouldQueue() || host.isMotionActive()) {
    host.transactions.enqueue(segment, policy, stage)
    return true
  }
  host.startTransaction(segment, stage)
  return true
}

export function cancelStagedProjectionTransaction<TMessage, TOptimistic>(
  host: ProjectionTransactionHost<TMessage, TOptimistic>,
  segment: Pick<ProjectionCommitToken, 'sessionId' | 'generation' | 'segmentRevision'>,
): boolean {
  const pending = host.transactions.getPending()
  if (
    pending?.stage &&
    pending.segment.sessionId === segment.sessionId &&
    pending.segment.generation === segment.generation &&
    pending.segment.segmentRevision === segment.segmentRevision
  ) {
    host.transactions.clearPending()
    host.rollbackStagedTransaction(pending)
    host.applySettledTransactionContinuations({ evaluatePostCommitInteractions: false })
    return true
  }
  return host.transactions.removeQueuedStage(segment)
}

function cancelTransactionsBeforeGeneration<TMessage, TOptimistic>(
  host: ProjectionTransactionHost<TMessage, TOptimistic>,
  segment: LoadedSegment<TMessage, TOptimistic>,
): void {
  const cancelled = host.transactions.cancelPendingBeforeGeneration(segment.generation)
  if (cancelled) {
    if (cancelled.timeoutHandle !== null) {
      host.scheduler.clearTimeout(cancelled.timeoutHandle)
    }
  }
  host.transactions.removeQueuedBeforeGeneration(segment.generation)
  const snapshot = host.getSnapshot()
  if (
    segment.generation > snapshot.generation &&
    !shouldPreservePendingIntentForSegment(snapshot, segment)
  ) {
    // 新 generation 让旧 requestToken 失效；matching follow/latest 和 destination/around 除外。
    host.cancelPendingRuntimeMotion()
    host.resetSnapshot(host.interactions.resetForGeneration(snapshot))
    host.syncScrollIntentBottomLock()
  }
}

export function rollbackStagedProjection<TMessage, TOptimistic>(
  input: {
    scheduler: RuntimeScheduler
    clearPendingEdgeSlotProjection(): void
    dirtyRange: RuntimeDirtyRangeRegistry
    restoreSnapshot(snapshot: MessageListSnapshot<TMessage, TOptimistic>): void
    syncScrollIntentBottomLock(): void
    emitSnapshot(): void
  },
  pending: PendingTransaction<TMessage, TOptimistic>,
): void {
  if (pending.timeoutHandle !== null) {
    input.scheduler.clearTimeout(pending.timeoutHandle)
  }
  input.clearPendingEdgeSlotProjection()
  input.dirtyRange.clear()
  const rollback = pending.rollbackSnapshot
  if (!rollback) return
  // DOM 尚未收到有效 ack，rollback 只发布旧 snapshot，绝不补偿或改写 scrollTop。
  input.restoreSnapshot({
    ...withNextProjectionRevision({ ...rollback, viewportPhase: 'IDLE' }),
    viewportPhase: 'IDLE',
  })
  input.syncScrollIntentBottomLock()
  input.emitSnapshot()
}
