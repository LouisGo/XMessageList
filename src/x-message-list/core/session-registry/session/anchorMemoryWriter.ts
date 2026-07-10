import type {
  MessageListAnchorMemoryValue,
  MessageListSessionContext,
} from '../contracts'

export class MessageListAnchorMemoryWriter<Source> {
  private pending: MessageListAnchorMemoryValue | null = null
  private flushing = false
  private destroyed = false

  constructor(
    private readonly context: MessageListSessionContext<Source>,
    private readonly save: (
      context: MessageListSessionContext<Source>,
      value: MessageListAnchorMemoryValue,
    ) => void | Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  enqueue(value: MessageListAnchorMemoryValue): void {
    if (this.destroyed) return
    this.pending = value
    void this.flush()
  }

  destroy(): void {
    this.destroyed = true
    this.pending = null
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.destroyed) return
    this.flushing = true

    try {
      while (!this.destroyed && this.pending) {
        const value = this.pending
        this.pending = null

        try {
          await this.save(this.context, value)
        } catch (error) {
          this.onError(error)
        }
      }
    } finally {
      this.flushing = false
      if (!this.destroyed && this.pending) {
        void this.flush()
      }
    }
  }
}
