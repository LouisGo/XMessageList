import type { ViewportPhase } from '../contracts/snapshot'

export type ReadySubstate =
  | 'READY_IDLE'
  | 'READY_EDGE_PENDING'
  | 'READY_FOLLOW_BOTTOM_PENDING'
  | 'READY_DESTINATION_PENDING'
  | 'READY_UNDERFLOW_PENDING'
  | 'READY_VIEWPORT_COMPACTION_PENDING'

export type TransactionState =
  | 'idle'
  | 'queued'
  | 'active'
  | 'measuring'
  | 'correcting'
  | 'settling'

export type DestinationState =
  | 'idle'
  | 'pendingData'
  | 'resolvingDom'
  | 'settled'
  | 'interrupted'

export type RuntimeStateAxesSnapshot = {
  readySubstate: ReadySubstate
  transactionState: TransactionState
  destinationState: DestinationState
}

export class RuntimeStateAxes {
  private readySubstate: ReadySubstate = 'READY_IDLE'

  private transactionState: TransactionState = 'idle'

  private destinationState: DestinationState = 'idle'

  getReadySubstate(): ReadySubstate {
    return this.readySubstate
  }

  isReadySubstate(...states: ReadySubstate[]): boolean {
    return states.includes(this.readySubstate)
  }

  markReadyIdle(): void {
    this.readySubstate = 'READY_IDLE'
  }

  markEdgePending(): void {
    this.readySubstate = 'READY_EDGE_PENDING'
  }

  markFollowBottomPending(): void {
    this.readySubstate = 'READY_FOLLOW_BOTTOM_PENDING'
  }

  markDestinationPending(): void {
    this.readySubstate = 'READY_DESTINATION_PENDING'
  }

  markUnderflowPending(): void {
    this.readySubstate = 'READY_UNDERFLOW_PENDING'
  }

  markViewportCompactionPending(): void {
    this.readySubstate = 'READY_VIEWPORT_COMPACTION_PENDING'
  }

  getTransactionState(): TransactionState {
    return this.transactionState
  }

  markTransactionIdle(): void {
    this.transactionState = 'idle'
  }

  markTransactionQueued(): void {
    this.transactionState = 'queued'
  }

  markTransactionActive(): void {
    this.transactionState = 'active'
  }

  markTransactionMeasuring(): void {
    this.transactionState = 'measuring'
  }

  markTransactionCorrecting(): void {
    this.transactionState = 'correcting'
  }

  markTransactionSettling(): void {
    this.transactionState = 'settling'
  }

  markTransactionForViewportPhase(phase: ViewportPhase): void {
    if (phase === 'PROJECTING' || phase === 'MOTION') {
      this.markTransactionActive()
      return
    }

    if (phase === 'MEASURING') {
      this.markTransactionMeasuring()
      return
    }

    if (phase === 'CORRECTING') {
      this.markTransactionCorrecting()
      return
    }

    this.markTransactionIdle()
  }

  getDestinationState(): DestinationState {
    return this.destinationState
  }

  markDestinationIdle(): void {
    this.destinationState = 'idle'
  }

  markDestinationPendingData(): void {
    this.destinationState = 'pendingData'
  }

  markDestinationResolvingDom(): void {
    this.destinationState = 'resolvingDom'
  }

  markDestinationSettled(): void {
    this.destinationState = 'settled'
  }

  markDestinationInterrupted(): void {
    this.destinationState = 'interrupted'
  }

  resetIntentAxes(): void {
    this.markReadyIdle()
    this.markDestinationIdle()
  }

  getSnapshot(): RuntimeStateAxesSnapshot {
    return {
      readySubstate: this.readySubstate,
      transactionState: this.transactionState,
      destinationState: this.destinationState,
    }
  }
}
