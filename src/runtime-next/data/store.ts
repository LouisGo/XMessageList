import type { MessageDataSnapshot } from './types'

export type RuntimeDataStoreOptions = {
  readonly feedId: string
  readonly generation: number
}

export class RuntimeDataStore<TMessage = unknown, TOptimistic = unknown> {
  readonly #feedId: string
  readonly #generation: number
  #snapshot: MessageDataSnapshot<TMessage, TOptimistic> | null = null

  constructor(options: RuntimeDataStoreOptions) {
    this.#feedId = options.feedId
    this.#generation = options.generation
  }

  setSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): boolean {
    if (!this.isCurrentSnapshot(snapshot)) {
      return false
    }

    this.#snapshot = snapshot

    return true
  }

  isCurrentSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): boolean {
    return snapshot.feedId === this.#feedId &&
      snapshot.generation === this.#generation
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
