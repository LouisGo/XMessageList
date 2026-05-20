import type {
  RuntimeNextTransactionId,
} from '../identity/types'
import type {
  ProjectionCommitToken,
} from '../projection/types'
import type {
  RuntimeTransaction,
  RuntimeTransactionIntent,
  TransactionAbortReason,
  TransactionLifecycleStage,
  TransactionStageRecord,
} from './types'

export type TransactionRunnerOptions<TMessage, TOptimistic> = {
  readonly now?: () => number
  readonly onStage?: (
    record: TransactionStageRecord<TMessage, TOptimistic>,
  ) => void
}

export class TransactionRunner<TMessage = unknown, TOptimistic = unknown> {
  readonly #now: () => number
  readonly #onStage: (
    record: TransactionStageRecord<TMessage, TOptimistic>,
  ) => void
  readonly #queue: RuntimeTransaction<TMessage, TOptimistic>[] = []
  #active: RuntimeTransaction<TMessage, TOptimistic> | null = null
  #nextTransactionSequence = 1

  constructor(options: TransactionRunnerOptions<TMessage, TOptimistic> = {}) {
    this.#now = options.now ?? Date.now
    this.#onStage = options.onStage ?? noop
  }

  enqueue(
    intent: RuntimeTransactionIntent<TMessage, TOptimistic>,
  ): RuntimeTransaction<TMessage, TOptimistic> {
    const transaction = this.#createTransaction(intent)
    this.#queue.push(transaction)
    this.#emit(transaction, null)

    return transaction
  }

  startNext(): RuntimeTransaction<TMessage, TOptimistic> | null {
    if (this.#active !== null) {
      return null
    }

    const next = this.#queue.shift()
    if (next === undefined) {
      return null
    }

    this.#active = this.#moveTo(next, 'running', {
      startedAt: this.#now(),
    })

    return this.#active
  }

  markProjectionPublished(
    transactionId: RuntimeNextTransactionId,
    commitToken: ProjectionCommitToken,
  ): RuntimeTransaction<TMessage, TOptimistic> | null {
    return this.#markActive(transactionId, 'projection-published', {
      commitToken,
    })
  }

  markCommitAck(
    transactionId: RuntimeNextTransactionId,
  ): RuntimeTransaction<TMessage, TOptimistic> | null {
    return this.#markActive(transactionId, 'commit-ack')
  }

  markMeasurementCorrection(
    transactionId: RuntimeNextTransactionId,
  ): RuntimeTransaction<TMessage, TOptimistic> | null {
    return this.#markActive(transactionId, 'measurement-correction')
  }

  markMetricsPromoted(
    transactionId: RuntimeNextTransactionId,
  ): RuntimeTransaction<TMessage, TOptimistic> | null {
    return this.#markActive(transactionId, 'metrics-promoted')
  }

  completeActive(transactionId: RuntimeNextTransactionId): boolean {
    if (this.#active?.id !== transactionId) {
      return false
    }

    this.#active = null

    return true
  }

  abortActive(
    reason: TransactionAbortReason,
  ): RuntimeTransaction<TMessage, TOptimistic> | null {
    if (this.#active === null) {
      return null
    }

    const aborted = this.#moveTo(this.#active, 'aborted', {
      abortReason: reason,
    })
    this.#active = null

    return aborted
  }

  clearQueue(): void {
    this.#queue.length = 0
  }

  getActive(): RuntimeTransaction<TMessage, TOptimistic> | null {
    return this.#active
  }

  getQueueLength(): number {
    return this.#queue.length
  }

  #markActive(
    transactionId: RuntimeNextTransactionId,
    stage: TransactionLifecycleStage,
    patch: Partial<RuntimeTransaction<TMessage, TOptimistic>> = {},
  ): RuntimeTransaction<TMessage, TOptimistic> | null {
    if (this.#active?.id !== transactionId) {
      return null
    }

    this.#active = this.#moveTo(this.#active, stage, patch)

    return this.#active
  }

  #createTransaction(
    intent: RuntimeTransactionIntent<TMessage, TOptimistic>,
  ): RuntimeTransaction<TMessage, TOptimistic> {
    const sequence = this.#nextTransactionSequence
    this.#nextTransactionSequence += 1

    return {
      id: `p4-tx-${sequence}`,
      kind: intent.kind,
      intent,
      stage: 'queued',
      queuedAt: this.#now(),
    }
  }

  #moveTo(
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
    stage: TransactionLifecycleStage,
    patch: Partial<RuntimeTransaction<TMessage, TOptimistic>> = {},
  ): RuntimeTransaction<TMessage, TOptimistic> {
    const previousStage = transaction.stage
    const next = {
      ...transaction,
      ...patch,
      stage,
    }
    this.#emit(next, previousStage)

    return next
  }

  #emit(
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
    previousStage: TransactionLifecycleStage | null,
  ): void {
    this.#onStage({
      transaction,
      previousStage,
    })
  }
}

function noop(): void {}
