import type { CustomScrollbarDom } from './customScrollbarDom'

type ObserverWindow = Window &
  Partial<
    Pick<
      typeof globalThis,
      'AbortController' | 'MutationObserver' | 'ResizeObserver'
    >
  >

export type CustomScrollbarObserverHandlers = {
  onScroll(): void
  onContainerPointerEnter(): void
  onContainerPointerLeave(): void
  onScrollbarPointerEnter(): void
  onScrollbarPointerLeave(): void
  onTrackPointerDown(event: PointerEvent): void
  onThumbPointerDown(event: PointerEvent): void
  onDocumentPointerMove(event: PointerEvent): void
  onDocumentPointerEnd(event: PointerEvent): void
  onGeometryDirty(): void
}

export class CustomScrollbarObservers {
  private readonly abortController: AbortController
  private resizeObserver: ResizeObserver | null = null
  private mutationObserver: MutationObserver | null = null
  private readonly observedChildren = new Set<Element>()

  constructor(
    private readonly dom: CustomScrollbarDom,
    private readonly handlers: CustomScrollbarObserverHandlers,
  ) {
    const AbortControllerCtor =
      this.getOwnerWindow().AbortController ?? globalThis.AbortController
    this.abortController = new AbortControllerCtor()
  }

  attach(): void {
    const { container, track, thumb, ownerDocument } = this.dom
    const signal = this.abortController.signal

    container.addEventListener('scroll', this.handlers.onScroll, {
      passive: true,
      signal,
    })
    container.addEventListener('pointerenter', this.handlers.onContainerPointerEnter, {
      signal,
    })
    container.addEventListener('pointerleave', this.handlers.onContainerPointerLeave, {
      signal,
    })
    track.addEventListener('pointerenter', this.handlers.onScrollbarPointerEnter, {
      signal,
    })
    track.addEventListener('pointerleave', this.handlers.onScrollbarPointerLeave, {
      signal,
    })
    track.addEventListener('pointerdown', this.handlers.onTrackPointerDown, { signal })
    thumb.addEventListener('pointerdown', this.handlers.onThumbPointerDown, { signal })
    ownerDocument.addEventListener('pointermove', this.handlers.onDocumentPointerMove, {
      passive: false,
      signal,
    })
    ownerDocument.addEventListener('pointerup', this.handlers.onDocumentPointerEnd, {
      signal,
    })
    ownerDocument.addEventListener('pointercancel', this.handlers.onDocumentPointerEnd, {
      signal,
    })
    this.attachGeometryObservers()
  }

  destroy(): void {
    this.abortController.abort()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
    this.observedChildren.clear()
  }

  private attachGeometryObservers(): void {
    const { container } = this.dom
    const ownerWindow = this.getOwnerWindow()
    const ResizeObserverCtor =
      ownerWindow.ResizeObserver ?? globalThis.ResizeObserver
    const MutationObserverCtor =
      ownerWindow.MutationObserver ?? globalThis.MutationObserver

    if (typeof ResizeObserverCtor !== 'undefined') {
      this.resizeObserver = new ResizeObserverCtor(() => {
        this.handlers.onGeometryDirty()
      })
      this.resizeObserver.observe(container)
      this.syncObservedChildren()
    }

    if (typeof MutationObserverCtor !== 'undefined') {
      this.mutationObserver = new MutationObserverCtor(() => {
        this.syncObservedChildren()
        this.handlers.onGeometryDirty()
      })
      this.mutationObserver.observe(container, { childList: true })
    }
  }

  private getOwnerWindow(): ObserverWindow {
    return this.dom.ownerWindow as ObserverWindow
  }

  private syncObservedChildren(): void {
    if (!this.resizeObserver) {
      return
    }

    const nextChildren = new Set(Array.from(this.dom.container.children))

    for (const child of this.observedChildren) {
      if (!nextChildren.has(child)) {
        this.resizeObserver.unobserve(child)
        this.observedChildren.delete(child)
      }
    }

    for (const child of nextChildren) {
      if (!this.observedChildren.has(child)) {
        this.resizeObserver.observe(child)
        this.observedChildren.add(child)
      }
    }
  }
}
