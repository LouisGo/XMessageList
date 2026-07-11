import type { ViewportObservationChangedEvent } from '../../runtime/index'
import type { MessageListAdapter } from '../contracts'

export const DEFAULT_READ_RECEIPT_SENT_KEY_CAPACITY = 4_096
export const DEFAULT_READ_RECEIPT_PENDING_KEY_CAPACITY = 4_096
export const DEFAULT_READ_RECEIPT_BATCH_CAPACITY = 256

export class MessageListReadReceiptsWorker<Row, Conversation> {
  private readonly pendingRows = new Map<string, Row>()
  private readonly sentKeys = new Set<string>()
  private readonly inFlightKeys = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private generation = 0
  private destroyed = false

  constructor(
    private readonly adapter: MessageListAdapter<Row, Conversation>,
    private readonly getRowsByKeys: (keys: string[]) => Row[],
    private readonly sentKeyCapacity = DEFAULT_READ_RECEIPT_SENT_KEY_CAPACITY,
    private readonly pendingKeyCapacity = DEFAULT_READ_RECEIPT_PENDING_KEY_CAPACITY,
    private readonly batchCapacity = DEFAULT_READ_RECEIPT_BATCH_CAPACITY,
  ) {}

  handleObservation(event: ViewportObservationChangedEvent): void {
    if (this.destroyed) return
    const readReceipts = this.adapter.readReceipts

    if (!readReceipts || event.visibleKeys.length === 0) {
      return
    }

    const rows = this.getRowsByKeys([...new Set(event.visibleKeys)])

    for (const row of rows) {
      const key = this.adapter.row.getKey(row)

      if (this.sentKeys.has(key)) {
        this.rememberSentKey(key)
        continue
      }

      if (this.pendingRows.has(key)) {
        // pendingRows 同样是 latest-visible LRU；重复可见会刷新 row 快照及淘汰顺序。
        this.pendingRows.delete(key)
        this.pendingRows.set(key, row)
        continue
      }

      if (this.inFlightKeys.has(key)) {
        continue
      }

      if (readReceipts.shouldMarkRead && !readReceipts.shouldMarkRead(row)) {
        continue
      }

      this.pendingRows.set(key, row)
      this.trimPendingRows()
    }

    this.scheduleFlush()
  }

  destroy(): void {
    this.destroyed = true
    this.generation += 1
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
    }
    this.flushTimer = null
    this.pendingRows.clear()
    this.inFlightKeys.clear()
    this.sentKeys.clear()
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.pendingRows.size === 0) {
      return
    }

    const delay = this.adapter.readReceipts?.batchDelayMs ?? 100
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.requestIdleFlush()
    }, delay)
  }

  private requestIdleFlush(): void {
    const requestIdle = globalThis.requestIdleCallback

    if (requestIdle) {
      requestIdle(() => {
        void this.flush()
      }, { timeout: 50 })
      return
    }

    void this.flush()
  }

  private async flush(): Promise<void> {
    const readReceipts = this.adapter.readReceipts

    if (!readReceipts || this.inFlight || this.pendingRows.size === 0) {
      return
    }

    const capacity = Math.max(1, this.batchCapacity)
    const rows = Array.from(this.pendingRows.values()).slice(0, capacity)
    const keys = rows.map((row) => this.adapter.row.getKey(row))
    for (const key of keys) {
      this.pendingRows.delete(key)
      this.inFlightKeys.add(key)
    }
    this.inFlight = true
    const capturedGeneration = this.generation

    try {
      await readReceipts.markRead(rows)
      if (capturedGeneration !== this.generation || this.destroyed) return
      for (const key of keys) {
        this.rememberSentKey(key)
      }
    } catch (error) {
      if (capturedGeneration === this.generation && !this.destroyed) {
        readReceipts.onError?.(error)
      }
    } finally {
      if (capturedGeneration === this.generation && !this.destroyed) {
        for (const key of keys) this.inFlightKeys.delete(key)
        this.inFlight = false
        // 失败项不会自动重新入队；只有下一次 viewport observation 才允许重试，
        // 避免 SDK 持续失败时形成无用户触发的忙循环。
        this.scheduleFlush()
      }
    }
  }

  private rememberSentKey(key: string): void {
    // Set 保持插入顺序；重复成功回执先删除再插入即可作为轻量 LRU 使用。
    this.sentKeys.delete(key)
    this.sentKeys.add(key)
    const capacity = Math.max(1, this.sentKeyCapacity)
    while (this.sentKeys.size > capacity) {
      const oldest = this.sentKeys.values().next().value as string | undefined
      if (oldest === undefined) break
      this.sentKeys.delete(oldest)
    }
  }

  private trimPendingRows(): void {
    const capacity = Math.max(1, this.pendingKeyCapacity)
    while (this.pendingRows.size > capacity) {
      const oldest = this.pendingRows.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.pendingRows.delete(oldest)
    }
  }
}
