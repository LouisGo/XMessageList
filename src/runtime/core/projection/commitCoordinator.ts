import type {
  MessageViewportSnapshot,
  ProjectionCommit,
  RuntimeScheduler,
  ViewportTransactionKind,
} from '../../types'
import type { PublishResult, RuntimeCommitTimeoutMs } from '../state/runtimeTypes'

type PendingCommit = {
  feedId: string
  generation: number
  revision: number
  transactionKind: ViewportTransactionKind
  timeoutId: number
  resolve: () => void
  reject: (error: Error) => void
}

export class CommitCoordinator<TMessage, TOptimistic> {
  private pendingCommit: PendingCommit | null = null

  constructor(
    private readonly scheduler: RuntimeScheduler,
    private readonly commitTimeoutMs: RuntimeCommitTimeoutMs,
    private readonly emitError: (code: string) => void,
  ) {}

  notifyProjectionCommitted(commit: ProjectionCommit): void {
    const pending = this.pendingCommit

    if (
      !pending ||
      pending.feedId !== commit.feedId ||
      pending.generation !== commit.generation ||
      pending.revision !== commit.revision
    ) {
      // commit ack 必须精确匹配 feed/generation/revision，旧 React commit 不能唤醒新事务。
      return
    }

    this.scheduler.clearTimeout(pending.timeoutId)
    this.pendingCommit = null
    pending.resolve()
  }

  async waitForChanged(
    result: PublishResult<TMessage, TOptimistic>,
    transactionKind: ViewportTransactionKind,
  ): Promise<void> {
    if (!result.changed) {
      return
    }

    await this.waitForCommit(result.snapshot, transactionKind)
  }

  cancelPendingCommit(): void {
    if (!this.pendingCommit) {
      return
    }

    this.scheduler.clearTimeout(this.pendingCommit.timeoutId)
    this.pendingCommit.reject(new Error('Projection commit cancelled'))
    this.pendingCommit = null
  }

  private waitForCommit(
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
    transactionKind: ViewportTransactionKind,
  ): Promise<void> {
    // runtime 任何时刻只等待一个 projection commit；新事务会取消旧等待，交给上层 recovery 回滚。
    this.cancelPendingCommit()

    return new Promise((resolve, reject) => {
      const timeoutMs =
        transactionKind === 'bootstrap'
          ? this.commitTimeoutMs.bootstrap
          : transactionKind === 'jump'
            ? this.commitTimeoutMs.jump
            : this.commitTimeoutMs.normal
      const timeoutId = this.scheduler.setTimeout(() => {
        this.pendingCommit = null
        this.emitError(`commit-timeout-${transactionKind}`)
        reject(new Error(`Projection commit timed out: ${transactionKind}`))
      }, timeoutMs)

      this.pendingCommit = {
        feedId: snapshot.feedId,
        generation: snapshot.generation,
        revision: snapshot.revision,
        transactionKind,
        timeoutId,
        resolve,
        reject,
      }
    })
  }
}
