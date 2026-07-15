export class MessageListSessionViewRetention {
  private readonly listeners = new Set<() => void>()
  private readonly views = new Map<number, 'staging' | 'active'>()
  private nextViewId = 0

  constructor(
    private readonly onRetainedChange: (retained: boolean) => void,
    private readonly onRelease: () => void,
    private readonly onActiveChange: (active: boolean) => void,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  retain(
    presentation: 'staging' | 'active' = 'active',
  ): (() => void) & {
    release: () => void
    setPresentation: (next: 'staging' | 'active') => void
  } {
    const wasRetained = this.hasRetainedView()
    const wasActive = this.hasActiveView()
    const viewId = ++this.nextViewId
    this.views.set(viewId, presentation)
    if (!wasRetained) this.onRetainedChange(true)
    if (!wasActive && this.hasActiveView()) this.onActiveChange(true)
    let released = false
    const release = () => {
      if (released) {
        return
      }
      released = true
      const activeBeforeRelease = this.hasActiveView()
      this.views.delete(viewId)
      this.onRelease()
      if (activeBeforeRelease && !this.hasActiveView()) this.onActiveChange(false)
      if (!this.hasRetainedView()) this.onRetainedChange(false)
    }
    return Object.assign(release, {
      release,
      setPresentation: (next: 'staging' | 'active') => {
        if (released || this.views.get(viewId) === next) {
          return
        }
        const wasViewActive = this.hasActiveView()
        this.views.set(viewId, next)
        const isViewActive = this.hasActiveView()
        if (wasViewActive !== isViewActive) this.onActiveChange(isViewActive)
      },
    })
  }

  hasRetainedView(): boolean {
    return this.views.size > 0
  }

  hasActiveView(): boolean {
    return Array.from(this.views.values()).some(
      (presentation) => presentation === 'active',
    )
  }

  getRetainCount(): number {
    return this.views.size
  }

  notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  destroy(): void {
    this.listeners.clear()
    this.views.clear()
  }
}
