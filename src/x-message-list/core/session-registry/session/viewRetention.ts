export class MessageListSessionViewRetention {
  private readonly listeners = new Set<() => void>()
  private retainCount = 0

  constructor(
    private readonly onRetainedChange: (retained: boolean) => void,
    private readonly onRelease: () => void,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  retain(): () => void {
    const wasRetained = this.hasRetainedView()
    this.retainCount += 1
    if (!wasRetained) this.onRetainedChange(true)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.retainCount = Math.max(0, this.retainCount - 1)
      this.onRelease()
      if (!this.hasRetainedView()) this.onRetainedChange(false)
    }
  }

  hasRetainedView(): boolean {
    return this.retainCount > 0
  }

  getRetainCount(): number {
    return this.retainCount
  }

  notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  destroy(): void {
    this.listeners.clear()
  }
}
