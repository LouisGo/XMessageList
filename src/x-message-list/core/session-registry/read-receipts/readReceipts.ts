import type { ViewportObservationChangedEvent } from '../../runtime/index'
import type { MessageListAdapter } from '../contracts'

export const DEFAULT_READ_RECEIPT_SENT_KEY_CAPACITY = 4_096

export class MessageListReadReceiptsWorker<Row, Conversation> {
  private readonly pendingRows = new Map<string, Row>()
  private readonly sentKeys = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false

  constructor(
    private readonly adapter: MessageListAdapter<Row, Conversation>,
    private readonly getRowsByKeys: (keys: string[]) => Row[],
    private readonly sentKeyCapacity = DEFAULT_READ_RECEIPT_SENT_KEY_CAPACITY,
  ) {}

  handleObservation(event: ViewportObservationChangedEvent): void {
    const readReceipts = this.adapter.readReceipts

    if (!readReceipts || event.visibleKeys.length === 0) {
      return
    }

    const rows = this.getRowsByKeys(event.visibleKeys)

    for (const row of rows) {
      const key = this.adapter.row.getKey(row)

      if (this.sentKeys.has(key)) {
        this.rememberSentKey(key)
        continue
      }

      if (this.pendingRows.has(key)) {
        continue
      }

      if (readReceipts.shouldMarkRead && !readReceipts.shouldMarkRead(row)) {
        continue
      }

      this.pendingRows.set(key, row)
    }

    this.scheduleFlush()
  }

  destroy(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
    }
    this.flushTimer = null
    this.pendingRows.clear()
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

    const rows = Array.from(this.pendingRows.values())
    this.pendingRows.clear()
    this.inFlight = true

    try {
      await readReceipts.markRead(rows)
      for (const row of rows) {
        this.rememberSentKey(this.adapter.row.getKey(row))
      }
    } catch (error) {
      readReceipts.onError?.(error)
    } finally {
      this.inFlight = false
      this.scheduleFlush()
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
}
