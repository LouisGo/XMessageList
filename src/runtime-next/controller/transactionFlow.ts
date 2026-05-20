import type { MessageDataSnapshot } from '../data/types'
import type { RuntimeDataStore } from '../data/store'
import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type { PendingGeometryProjection } from '../geometry/publication/publication.types'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import type {
  PhysicalSegmentRevisionController,
} from '../geometry/segment/segmentRevision'
import type { ProjectionStore } from '../projection/store'
import type { BottomLockState, ProjectionCommitToken } from '../projection/types'
import { isProjectionCommitTokenEqual } from '../projection/commitToken'
import type { ScrollWriterArbitration, ScrollWriterKind } from '../scroll/writerArbitration'
import { buildGeometryPlan, deriveCommittedMetrics } from '../transactions/geometryBuilder'
import type { GeometryBuildKind, GeometryBuildPlan } from '../transactions/geometryBuilder.types'
import type { TransactionRunner } from '../transactions/transactionRunner'
import type {
  RuntimeTransaction,
  RuntimeTransactionIntent,
  TransactionAbortReason,
} from '../transactions/types'
import { decidePromotionCorrection } from './transactionPromoter'
import {
  bootstrapStateAfterCommit,
  bootstrapStateForPublish,
  edgeStateFromSnapshot,
  phaseForTransaction,
  selectItemsByRenderWindow,
} from './controllerHelpers'

type PendingPublication<TMessage, TOptimistic> = {
  readonly transaction: RuntimeTransaction<TMessage, TOptimistic>
  readonly plan: GeometryBuildPlan<TMessage, TOptimistic>
  readonly publication: PendingGeometryProjection<TMessage, TOptimistic>
  readonly promotesBottomLock: boolean
}

export type RuntimeTransactionFlowContext<TMessage, TOptimistic> = {
  readonly data: RuntimeDataStore<TMessage, TOptimistic>
  readonly dom: RuntimeDomRegistry
  readonly projection: ProjectionStore<TMessage, TOptimistic>
  readonly metrics: PhysicalMetricsStore
  readonly revision: PhysicalSegmentRevisionController
  readonly writer: ScrollWriterArbitration
  readonly runner: TransactionRunner<TMessage, TOptimistic>
  readonly diagnostics: DiagnosticRecorder
  readonly getBottomLockState: () => BottomLockState
  readonly setBottomLockState: (state: BottomLockState) => void
  readonly getCurrentScrollTop: () => number
  readonly setCurrentScrollTop: (scrollTop: number) => void
  readonly armAckTimeout: (transactionId: string) => void
  readonly clearAckTimeout: () => void
  readonly enqueue: (intent: RuntimeTransactionIntent<TMessage, TOptimistic>) => void
  readonly finish: (transactionId: string) => void
  readonly abort: (reason: TransactionAbortReason) => void
}

export class RuntimeTransactionFlow<TMessage = unknown, TOptimistic = unknown> {
  readonly #ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>
  #pending: PendingPublication<TMessage, TOptimistic> | null = null

  constructor(ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>) {
    this.#ctx = ctx
  }

  begin(transaction: RuntimeTransaction<TMessage, TOptimistic>): void {
    if (transaction.kind === 'projectionRefresh') {
      this.#beginProjectionRefresh(transaction)
      return
    }
    this.#beginGeometryTransaction(transaction)
  }

  handleProjectionCommitted(commit: ProjectionCommitToken): void {
    const pending = this.#pending
    if (pending === null) return
    if (!isProjectionCommitTokenEqual(pending.publication.commitToken, commit)) {
      this.#ctx.diagnostics.record({
        kind: 'pending-segment-revision-exposed',
        severity: 'warn',
        owner: 'projection',
        message: 'stale projection commit ack ignored',
        details: { expected: pending.publication.commitToken, received: commit },
      })
      return
    }
    this.#ctx.clearAckTimeout()
    this.#ctx.runner.markCommitAck(pending.transaction.id)
    if (pending.transaction.kind === 'projectionRefresh') {
      this.#completeProjectionRefresh(pending)
      return
    }
    const result = this.#ctx.revision.acknowledgeCommit(commit)
    if (!result.committed) {
      this.#ctx.abort('commit-token-mismatch')
      return
    }
    this.#promoteGeometry(pending, result.segment)
  }

  clearPending(): void {
    this.#pending = null
  }

  #beginProjectionRefresh(
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
  ): void {
    const data = this.#ctx.data.requireSnapshot()
    const snapshot = this.#ctx.projection.getSnapshot()
    const segment = this.#ctx.revision.getCommittedSegment()
    if (segment === null) {
      this.#ctx.abort('missing-data')
      return
    }
    const token = {
      ...snapshot.commitToken,
      projectionRevision: snapshot.revision + 1,
      transactionId: transaction.id,
    }
    const publication = {
      commitToken: token,
      segment,
      items: selectItemsByRenderWindow(data.items, snapshot.renderWindow),
      renderWindow: snapshot.renderWindow,
      topSpacer: snapshot.topSpacer,
      bottomSpacer: snapshot.bottomSpacer,
      naturalBlankHeight: snapshot.naturalBlankHeight,
      physicalWindowHeight: this.#ctx.metrics.getMetrics().physicalWindowSize,
      mountedRowsHeightEstimate: segment.estimatedRowsHeight,
    }
    this.#pending = {
      transaction,
      plan: this.#planFromPublication(publication),
      publication,
      promotesBottomLock: false,
    }
    this.#publishPending(publication, transaction, data)
  }

  #beginGeometryTransaction(
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
  ): void {
    const data = this.#ctx.data.requireSnapshot()
    const kind = transaction.kind as GeometryBuildKind
    const plan = buildGeometryPlan({
      kind,
      data,
      viewportSize: this.#ctx.dom.getViewportSize(),
      currentScrollTop: this.#ctx.dom.getScrollTop(),
      currentSegment: this.#ctx.revision.getCommittedSegment() ?? undefined,
      target: 'target' in transaction.intent ? transaction.intent.target : undefined,
      direction: 'direction' in transaction.intent ? transaction.intent.direction : undefined,
    })
    const pending = this.#ctx.revision.startPublication({
      projectionRevision: this.#ctx.projection.getSnapshot().revision + 1,
      transactionId: transaction.id,
      reason: this.#revisionReason(kind),
      relayoutReason: kind === 'segmentRelayout' && 'reason' in transaction.intent
        ? transaction.intent.reason as never
        : undefined,
      segment: plan.segment,
    })
    const publication = {
      commitToken: pending.commitToken,
      segment: pending.segment,
      items: plan.items,
      renderWindow: plan.renderWindow,
      topSpacer: plan.topSpacer,
      bottomSpacer: plan.bottomSpacer,
      naturalBlankHeight: plan.naturalBlankHeight,
      physicalWindowHeight: plan.physicalWindowHeight,
      mountedRowsHeightEstimate: plan.mountedRowsHeightEstimate,
    }
    this.#pending = {
      transaction,
      plan,
      publication,
      promotesBottomLock: kind === 'followBottom' && !data.hasMoreAfter,
    }
    this.#publishPending(publication, transaction, data)
  }

  #publishPending(
    publication: PendingGeometryProjection<TMessage, TOptimistic>,
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    this.#ctx.projection.publish({
      revision: publication.commitToken.projectionRevision,
      commitToken: publication.commitToken,
      items: publication.items,
      renderWindow: publication.renderWindow,
      topSpacer: publication.topSpacer,
      bottomSpacer: publication.bottomSpacer,
      naturalBlankHeight: publication.naturalBlankHeight,
      bottomLockState: this.#ctx.getBottomLockState(),
      bootstrapState: bootstrapStateForPublish(
        transaction.kind,
        this.#ctx.projection.getSnapshot().bootstrapState,
      ),
      viewportPhase: phaseForTransaction(transaction.kind),
      edgeState: edgeStateFromSnapshot(data),
    })
    this.#ctx.runner.markProjectionPublished(transaction.id, publication.commitToken)
    this.#ctx.armAckTimeout(transaction.id)
  }

  #completeProjectionRefresh(
    pending: PendingPublication<TMessage, TOptimistic>,
  ): void {
    const measurement = this.#ctx.dom.measureRows(
      pending.publication.renderWindow.itemKeys,
    )
    const decision = decidePromotionCorrection({
      publication: pending.publication,
      dataRevision: this.#ctx.data.requireSnapshot().revision,
      scrollTop: this.#ctx.getCurrentScrollTop(),
      clientHeight: this.#ctx.dom.getViewportSize().clientHeight,
      measuredRowsHeight: measurement.mountedRowsHeight,
      previousMetrics: this.#ctx.metrics.getMetrics(),
      previousCorrections: [],
    })
    this.#ctx.runner.markMeasurementCorrection(pending.transaction.id)
    this.#ctx.runner.markMetricsPromoted(pending.transaction.id)
    if (decision.correction.kind === 'segment-relayout') {
      this.#ctx.enqueue({
        kind: 'segmentRelayout',
        reason: decision.correction.reason,
      })
    }
    this.#ctx.finish(pending.transaction.id)
  }

  #promoteGeometry(
    pending: PendingPublication<TMessage, TOptimistic>,
    segment: PhysicalSegment,
  ): void {
    const measurement = this.#ctx.dom.measureRows(
      pending.publication.renderWindow.itemKeys,
    )
    const promotion = decidePromotionCorrection({
      publication: pending.publication,
      dataRevision: this.#ctx.data.requireSnapshot().revision,
      scrollTop: this.#ctx.getCurrentScrollTop(),
      clientHeight: this.#ctx.dom.getViewportSize().clientHeight,
      measuredRowsHeight: measurement.mountedRowsHeight,
      previousMetrics: this.#ctx.metrics.getMetrics(),
      previousCorrections: [],
    })
    if (promotion.correction.kind === 'segment-relayout') {
      this.#ctx.abort('error')
      this.#ctx.enqueue({
        kind: 'segmentRelayout',
        reason: promotion.correction.reason,
      })
      return
    }
    const topSpacer = pending.publication.topSpacer + promotion.correction.topDelta
    const bottomSpacer =
      pending.publication.bottomSpacer + promotion.correction.bottomDelta
    const scrollTop = this.#writeTransactionScrollTop(pending)
    const metrics = deriveCommittedMetrics({
      segmentId: segment.segmentId,
      segmentRevision: segment.segmentRevision,
      renderWindowStart: pending.publication.renderWindow.itemKeys[0] ?? null,
      renderWindowEnd: pending.publication.renderWindow.itemKeys.at(-1) ?? null,
      topSpacer,
      bottomSpacer,
      mountedRowsHeight: promotion.mountedRowsHeight,
      naturalBlankHeight: pending.publication.naturalBlankHeight,
      physicalWindowHeight: pending.publication.physicalWindowHeight,
      scrollHeightCap: segment.scrollHeightCap,
      capMode: segment.capMode,
      viewportSize: this.#ctx.dom.getViewportSize(),
      scrollTop,
    })
    this.#ctx.runner.markMeasurementCorrection(pending.transaction.id)
    this.#ctx.metrics.promote(metrics)
    this.#ctx.setBottomLockState(pending.promotesBottomLock ? 'LOCKED' : 'UNLOCKED')
    this.#ctx.projection.publish({
      revision: pending.publication.commitToken.projectionRevision,
      commitToken: pending.publication.commitToken,
      items: pending.publication.items,
      renderWindow: pending.publication.renderWindow,
      topSpacer,
      bottomSpacer,
      naturalBlankHeight: pending.publication.naturalBlankHeight,
      bottomLockState: this.#ctx.getBottomLockState(),
      bootstrapState: bootstrapStateAfterCommit(
        pending.transaction.kind,
        this.#ctx.data.requireSnapshot(),
        this.#ctx.projection.getSnapshot().bootstrapState,
      ),
      viewportPhase: 'IDLE',
      edgeState: this.#ctx.projection.getSnapshot().edgeState,
    })
    this.#ctx.runner.markMetricsPromoted(pending.transaction.id)
    this.#ctx.finish(pending.transaction.id)
  }

  #writeTransactionScrollTop(
    pending: PendingPublication<TMessage, TOptimistic>,
  ): number {
    const kind = pending.transaction.kind
    const maxTop = Math.max(
      0,
      pending.publication.physicalWindowHeight -
        this.#ctx.dom.getViewportSize().clientHeight,
    )
    const desired = kind === 'followBottom'
      ? maxTop
      : kind === 'segmentShift'
        ? Math.min(maxTop, this.#ctx.dom.getViewportSize().clientHeight)
        : this.#ctx.getCurrentScrollTop()
    if (desired === this.#ctx.getCurrentScrollTop()) return desired
    const writerKind: ScrollWriterKind = kind === 'followBottom'
      ? 'follow-bottom'
      : kind === 'segmentShift'
        ? 'segment-shift-rebase'
        : 'anchor-correction'
    const token = { transactionId: pending.transaction.id, kind: writerKind }
    if (!this.#ctx.writer.acquire(token).acquired) {
      this.#ctx.diagnostics.record({
        kind: 'writer-arbitration',
        severity: 'warn',
        owner: 'scroll',
        message: 'transaction writer denied',
      })
      return this.#ctx.getCurrentScrollTop()
    }
    if (this.#ctx.writer.writeScrollTop(this.#ctx.dom.getContainer(), desired, token)) {
      this.#ctx.setCurrentScrollTop(desired)
    }
    this.#ctx.writer.release(token)
    return this.#ctx.getCurrentScrollTop()
  }

  #planFromPublication(
    publication: PendingGeometryProjection<TMessage, TOptimistic>,
  ): GeometryBuildPlan<TMessage, TOptimistic> {
    return {
      segment: publication.segment,
      items: publication.items,
      renderWindow: publication.renderWindow,
      topSpacer: publication.topSpacer,
      bottomSpacer: publication.bottomSpacer,
      naturalBlankHeight: publication.naturalBlankHeight,
      physicalWindowHeight: publication.physicalWindowHeight,
      mountedRowsHeightEstimate: publication.mountedRowsHeightEstimate,
      role: publication.segment.logicalRole,
      capMode: publication.segment.capMode,
    }
  }

  #revisionReason(kind: GeometryBuildKind) {
    return kind === 'segmentRelayout' ? 'segmentRelayout' : kind
  }
}
