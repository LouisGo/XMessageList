import type { MessageListRuntimeEvent } from '../contracts/events'
import type { RuntimeScheduler } from '../contracts/options'
import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { RuntimeInteractionState } from '../interactions/interactionState'
import type { PendingTransaction } from './controllerTransactionHelpers'
import type { ProjectionTransactionQueue } from './transactionQueue'

export type ViewCommitTimeoutHost<TMessage, TOptimistic> = {
  readonly transactions: ProjectionTransactionQueue<TMessage, TOptimistic>
  readonly interactions: RuntimeInteractionState<TMessage, TOptimistic>
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  rollbackStagedTransaction(pending: PendingTransaction<TMessage, TOptimistic>): void
  applyInteractionProjection(snapshot: MessageListSnapshot<TMessage, TOptimistic>): void
  setViewportPhase(phase: MessageListSnapshot['viewportPhase']): void
  pushDiagnostic(name: string, severity: 'error', details: Record<string, unknown>): void
  emitRuntimeEvent(event: MessageListRuntimeEvent): void
  emitProjectionSettled(token: ProjectionCommitToken, status: 'commit-timeout'): void
  applySettledTransactionContinuations(options: { evaluatePostCommitInteractions: false }): void
}

/**
 * DOM commit timeout 只属于已挂载视图。Session 可以在没有 React view 时先投影和
 * 预加载；首次 retain 后再计时，最后一个 view release 时暂停当前计时。
 */
export class ViewCommitTimeoutController<TMessage, TOptimistic> {
  private retained = true

  constructor(
    private readonly host: ViewCommitTimeoutHost<TMessage, TOptimistic>,
    private readonly scheduler: RuntimeScheduler,
    private readonly timeoutMs: number,
  ) {}

  schedule(token: ProjectionCommitToken): number | null {
    return this.retained
      ? this.scheduler.setTimeout(() => this.handleTimeout(token), this.timeoutMs)
      : null
  }

  clear(timeoutHandle: number | null | undefined): void {
    if (timeoutHandle !== null && timeoutHandle !== undefined) {
      this.scheduler.clearTimeout(timeoutHandle)
    }
  }

  setRetained(
    retained: boolean,
    pending: PendingTransaction<TMessage, TOptimistic> | null,
  ): void {
    if (this.retained === retained) return
    this.retained = retained
    if (!pending) return
    this.clear(pending.timeoutHandle)
    pending.timeoutHandle = this.schedule(pending.token)
  }

  private handleTimeout(token: ProjectionCommitToken): void {
    const pending = this.host.transactions.clearPendingToken(token)
    if (!pending) return
    this.host.transactions.beginAdvancing()
    try {
      if (pending.stage) {
        this.host.rollbackStagedTransaction(pending)
      } else {
        this.host.applyInteractionProjection(
          this.host.interactions.resetForGeneration(this.host.snapshot),
        )
        this.host.setViewportPhase('IDLE')
      }
      this.host.pushDiagnostic('transaction.commitTimeout', 'error', token)
      this.host.emitRuntimeEvent({
        type: 'viewportError',
        sessionId: token.sessionId,
        code: 'commit-timeout',
        message: 'Projection commit timed out.',
      })
      this.host.emitProjectionSettled(token, 'commit-timeout')
    } finally {
      this.host.transactions.endAdvancing()
    }
    this.host.applySettledTransactionContinuations({
      evaluatePostCommitInteractions: false,
    })
  }
}
