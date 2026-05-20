import type { PhysicalScrollMetrics } from '../types'
import { createInitialPhysicalScrollMetrics } from './initialMetrics'

export type PhysicalMetricsStoreOptions = {
  readonly feedId: string
  readonly generation: number
  readonly onChange?: () => void
}

export class PhysicalMetricsStore {
  readonly #onChange: () => void
  #metrics: PhysicalScrollMetrics

  constructor(options: PhysicalMetricsStoreOptions) {
    this.#onChange = options.onChange ?? noop
    this.#metrics = createInitialPhysicalScrollMetrics(options)
  }

  promote(metrics: PhysicalScrollMetrics): void {
    this.#metrics = metrics
    this.#onChange()
  }

  patchScrollPosition(scrollPosition: number): void {
    this.#metrics = {
      ...this.#metrics,
      scrollPosition,
    }
    this.#onChange()
  }

  getMetrics(): PhysicalScrollMetrics {
    return this.#metrics
  }
}

function noop(): void {}
