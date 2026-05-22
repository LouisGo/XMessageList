import type {
  ViewportTransactionKind,
} from '../../types'
import type { RuntimeDiagnosticEmitter } from '../state/runtimeTypes'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'

type TransactionDropReason =
  | 'reset-supersede'
  | 'key-supersede'
  | 'clear'
  | 'stop'

type RuntimeTransactionDiagnosticsDeps = {
  stateAxes: RuntimeStateAxes
  getPendingCount: () => number
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class RuntimeTransactionDiagnostics {
  private activeTransactionKind: ViewportTransactionKind | null = null

  constructor(private readonly deps: RuntimeTransactionDiagnosticsDeps) {}

  getActiveTransactionKind(): ViewportTransactionKind | null {
    return this.activeTransactionKind
  }

  handleEnqueue(kind: ViewportTransactionKind, id: string): void {
    this.deps.stateAxes.setTransactionState(
      this.deps.getPendingCount() > 1 ? 'queued' : 'active',
    )
    this.emit('enqueue', kind, id)
  }

  handleStart(kind: ViewportTransactionKind, id: string): void {
    this.activeTransactionKind = kind
    this.deps.stateAxes.setTransactionState('active')
    this.emit('start', kind, id)
  }

  handleComplete(kind: ViewportTransactionKind, id: string): void {
    this.deps.stateAxes.setTransactionState(
      this.deps.getPendingCount() > 0 ? 'queued' : 'idle',
    )
    this.emit('complete', kind, id)
    this.activeTransactionKind = null
  }

  handleDrop(
    kind: ViewportTransactionKind,
    id: string,
    reason: TransactionDropReason,
  ): void {
    this.deps.stateAxes.setTransactionState(
      this.deps.getPendingCount() > 0 ? 'queued' : 'idle',
    )
    this.emit('drop', kind, id, { reason })
    this.activeTransactionKind = null
  }

  handleError(
    kind: ViewportTransactionKind,
    id: string,
    error: unknown,
  ): void {
    this.deps.stateAxes.setTransactionState(
      this.deps.getPendingCount() > 0 ? 'queued' : 'idle',
    )
    this.emit('error', kind, id, {
      error: error instanceof Error ? error.message : String(error),
    })
    this.activeTransactionKind = null
  }

  private emit(
    phase: 'enqueue' | 'start' | 'complete' | 'drop' | 'error',
    kind: ViewportTransactionKind,
    id: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.deps.emitDiagnostic({
      channel: 'transaction',
      severity: phase === 'error' ? 'error' : 'debug',
      name: `transaction.${phase}`,
      correlationId: `transaction:${id}`,
      details: () => ({
        kind,
        id,
        queueDepth: this.deps.getPendingCount(),
        ...extra,
      }),
    })
  }
}
