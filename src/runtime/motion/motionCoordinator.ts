export type MotionState = 'idle' | 'reserved'

export class MotionCoordinator {
  private state: MotionState = 'idle'

  getState(): MotionState {
    return this.state
  }

  reservePostCommitOpportunity(): void {
    this.state = 'reserved'
  }

  consumePostCommitOpportunity(): boolean {
    if (this.state === 'reserved') {
      this.state = 'idle'
    }

    return false
  }

  reset(): void {
    this.state = 'idle'
  }
}
