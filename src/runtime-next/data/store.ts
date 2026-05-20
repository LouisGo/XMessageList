import type { MessageDataSnapshot } from './types'

export class RuntimeDataStore<TMessage = unknown, TOptimistic = unknown> {
  #snapshot: MessageDataSnapshot<TMessage, TOptimistic> | null = null

  setSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): void {
    this.#snapshot = snapshot
  }

  getSnapshot(): MessageDataSnapshot<TMessage, TOptimistic> | null {
    return this.#snapshot
  }

  requireSnapshot(): MessageDataSnapshot<TMessage, TOptimistic> {
    if (this.#snapshot === null) {
      throw new Error('runtime-next data snapshot is required')
    }

    return this.#snapshot
  }
}
