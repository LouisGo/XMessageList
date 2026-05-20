import type { ProjectionCommitToken } from '../projection/types'
import { isProjectionCommitTokenEqual } from '../projection/commitToken'
import { buildGeometryPlan } from '../transactions/geometryBuilder'
import { GeometryRelayoutBoundsError } from '../transactions/geometryBuilderRelayout'
import type { GeometryBuildKind, GeometryBuildPlan } from '../transactions/geometryBuilder.types'
import type { RuntimeTransaction } from '../transactions/types'
import {
  selectItemsByRenderWindow,
} from './controllerHelpers'
import {
  completeProjectionRefresh,
  planFromPublication,
  promoteGeometry,
  publishPending,
} from './transactionFlowPromotion'
import type {
  PendingPublication,
  RuntimeTransactionFlowContext,
} from './transactionFlow.types'

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
      completeProjectionRefresh(this.#ctx, pending)
      return
    }
    const result = this.#ctx.revision.acknowledgeCommit(commit)
    if (!result.committed) {
      this.#ctx.abort('commit-token-mismatch')
      return
    }
    promoteGeometry(this.#ctx, pending, result.segment)
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
      plan: planFromPublication(publication),
      publication,
      promotesBottomLock: false,
    }
    publishPending(this.#ctx, publication, transaction, data)
  }

  #beginGeometryTransaction(
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
  ): void {
    const data = this.#ctx.data.requireSnapshot()
    const kind = transaction.kind as GeometryBuildKind
    let plan: GeometryBuildPlan<TMessage, TOptimistic>
    try {
      plan = buildGeometryPlan({
        kind,
        data,
        viewportSize: this.#ctx.dom.getViewportSize(),
        currentScrollTop: this.#ctx.dom.getScrollTop(),
        currentSegment: this.#ctx.revision.getCommittedSegment() ?? undefined,
        target: 'target' in transaction.intent ? transaction.intent.target : undefined,
        direction: 'direction' in transaction.intent ? transaction.intent.direction : undefined,
      })
    } catch (error) {
      if (error instanceof GeometryRelayoutBoundsError) {
        this.#ctx.diagnostics.record({
          kind: 'transaction-error',
          severity: 'warn',
          owner: 'geometry',
          message: 'segmentRelayout could not recover logical bounds',
          details: {
            reason: error.reason,
            transactionId: transaction.id,
          },
        })
        this.#ctx.abort('missing-data')
        this.#ctx.recoverRelayoutBounds({
          key: error.anchorKey,
          offsetWithinMessage: 0,
        })
        return
      }

      throw error
    }
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
    publishPending(this.#ctx, publication, transaction, data)
  }

  #revisionReason(kind: GeometryBuildKind) {
    return kind === 'segmentRelayout' ? 'segmentRelayout' : kind
  }
}
