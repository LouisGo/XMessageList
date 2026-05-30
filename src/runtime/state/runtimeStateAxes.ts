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

  setReadySubstate(state: ReadySubstate): void {
    this.readySubstate = state
  }

  getTransactionState(): TransactionState {
    return this.transactionState
  }

  setTransactionState(state: TransactionState): void {
    this.transactionState = state
  }

  getDestinationState(): DestinationState {
    return this.destinationState
  }

  setDestinationState(state: DestinationState): void {
    this.destinationState = state
  }

  resetIntentAxes(): void {
    this.readySubstate = 'READY_IDLE'
    this.destinationState = 'idle'
  }

  getSnapshot(): RuntimeStateAxesSnapshot {
    return {
      readySubstate: this.readySubstate,
      transactionState: this.transactionState,
      destinationState: this.destinationState,
    }
  }
}
