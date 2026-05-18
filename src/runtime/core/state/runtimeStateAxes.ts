import type {
  DestinationState,
  TransactionState,
  ViewportPhase,
} from '../../types'
import type { ReadySubstate } from './runtimeTypes'

export type RuntimeStateAxesSnapshot = {
  readySubstate: ReadySubstate
  viewportPhase: ViewportPhase
  transactionState: TransactionState
  destinationState: DestinationState
}

/**
 * State axes 是 READY 期内部状态的单一写入口。
 * lifecycle state 仍留在 controller，避免把 attach/detach 与事务轴混成一个状态机。
 */
export class RuntimeStateAxes {
  private readySubstate: ReadySubstate = 'READY_IDLE'

  private viewportPhase: ViewportPhase = 'IDLE'

  private transactionState: TransactionState = 'idle'

  private destinationState: DestinationState = 'idle'

  getReadySubstate(): ReadySubstate {
    return this.readySubstate
  }

  setReadySubstate(state: ReadySubstate): void {
    this.readySubstate = state
  }

  getViewportPhase(): ViewportPhase {
    return this.viewportPhase
  }

  setViewportPhase(phase: ViewportPhase): void {
    this.viewportPhase = phase
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

  resetReadyIdle(): void {
    this.readySubstate = 'READY_IDLE'
    this.viewportPhase = 'IDLE'
    this.transactionState = 'idle'
    this.destinationState = 'idle'
  }

  getSnapshot(): RuntimeStateAxesSnapshot {
    return {
      readySubstate: this.readySubstate,
      viewportPhase: this.viewportPhase,
      transactionState: this.transactionState,
      destinationState: this.destinationState,
    }
  }
}
