import type { ViewportTransactionKind } from '../types'

type TransactionTask = {
  id: string
  kind: ViewportTransactionKind
  supersedeKey?: string
  run: () => Promise<void>
}

let transactionCounter = 0

/**
 * TransactionRunner 串行化所有会改变 DOM window、spacer 或 scrollTop 的操作。
 * Runtime 不能让 prepend / append / jump 并发，否则 commit ack 和测量结果会互相污染。
 */
export class TransactionRunner {
  private active = false

  private readonly queue: TransactionTask[] = []

  private stopped = false

  constructor(
    private readonly onTransactionStart?: (
      kind: ViewportTransactionKind,
      id: string,
    ) => void,
  ) {}

  enqueue(
    kind: ViewportTransactionKind,
    run: () => Promise<void>,
    supersedeKey?: string,
  ): string {
    const id = `${kind}-${transactionCounter += 1}`
    const task: TransactionTask = {
      id,
      kind,
      supersedeKey,
      run,
    }

    if (kind === 'reset') {
      this.queue.length = 0
    } else if (supersedeKey) {
      const firstSameKey = this.queue.findIndex(
        (queued) => queued.supersedeKey === supersedeKey,
      )

      if (firstSameKey >= 0) {
        this.queue.splice(firstSameKey, 1)
      }
    }

    this.queue.push(task)
    void this.drain()
    return id
  }

  clear(): void {
    this.queue.length = 0
  }

  dropBySupersedeKey(supersedeKey: string): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.supersedeKey === supersedeKey) {
        this.queue.splice(index, 1)
      }
    }
  }

  stop(): void {
    this.stopped = true
    this.clear()
  }

  resume(): void {
    this.stopped = false
    void this.drain()
  }

  getPendingCount(): number {
    return this.queue.length + (this.active ? 1 : 0)
  }

  private async drain(): Promise<void> {
    if (this.active || this.stopped) {
      return
    }

    const task = this.queue.shift()

    if (!task) {
      return
    }

    this.active = true

    try {
      this.onTransactionStart?.(task.kind, task.id)
      await task.run()
    } catch (error) {
      void error
    } finally {
      this.active = false
      void this.drain()
    }
  }
}
