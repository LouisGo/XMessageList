import {
  findKeyForAnchor,
} from './controllerHelpers'
import type { RuntimeDomRegistry } from './domRegistry'
import type { MessageIdentityAnchor } from './identity'
import type { VisualAnchor } from './measurement'
import type { RuntimeObserverFactory, RuntimeScheduler } from './options'
import type { MessageListSnapshot } from './snapshot'
import type { DestinationIntent, RuntimeEdge } from './interactionState'

export type RuntimeDomInteractionsOptions = {
  scheduler: RuntimeScheduler
  observerFactory: RuntimeObserverFactory | null
  registry: RuntimeDomRegistry
  onEdgeIntersect: (edge: RuntimeEdge) => void
}

export class RuntimeDomInteractions<TMessage, TOptimistic> {
  private beforeIntersectionObserver: IntersectionObserver | null = null

  private afterIntersectionObserver: IntersectionObserver | null = null

  private edgeSourceActiveUntil = 0

  private suppressScrollUntil = 0

  private readonly rowTopByKey = new Map<string, number>()

  private readonly handleScroll = (): void => {
    const now = this.options.scheduler.now()

    if (now < this.suppressScrollUntil) {
      return
    }

    this.edgeSourceActiveUntil = now + 200
  }

  constructor(private readonly options: RuntimeDomInteractionsOptions) {}

  attachScrollContainer(container: HTMLElement): void {
    this.options.registry.snapshot().scrollContainer?.removeEventListener(
      'scroll',
      this.handleScroll,
    )
    this.options.registry.setScrollContainer(container)
    container.addEventListener('scroll', this.handleScroll, { passive: true })
  }

  detachScrollContainer(): void {
    this.options.registry.snapshot().scrollContainer?.removeEventListener(
      'scroll',
      this.handleScroll,
    )
    this.disconnectEdgeObservers()
  }

  registerEdgeTrigger(edge: RuntimeEdge, element: HTMLElement | null): void {
    if (edge === 'before') {
      this.beforeIntersectionObserver?.disconnect()
      this.beforeIntersectionObserver = this.createEdgeObserver(edge, element)
      return
    }

    this.afterIntersectionObserver?.disconnect()
    this.afterIntersectionObserver = this.createEdgeObserver(edge, element)
  }

  beginDirectScroll(): void {
    this.edgeSourceActiveUntil = this.options.scheduler.now() + 200
  }

  writeDirectScrollTop(scrollTop: number): boolean {
    const container = this.options.registry.snapshot().scrollContainer

    if (!container) {
      return false
    }

    container.scrollTop = scrollTop
    return true
  }

  alignToMessage(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    target: MessageIdentityAnchor,
    align: DestinationIntent['align'],
  ): boolean {
    const key = findKeyForAnchor(snapshot, target)
    const container = this.options.registry.snapshot().scrollContainer
    const row = key ? this.options.registry.getRow(key) : null

    if (!row || !container) {
      return false
    }

    const containerRect = container.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const nextTop = resolveAlignedScrollTop(container, rowRect, containerRect, align)
    this.writeProgrammaticScroll(container, nextTop)
    return true
  }

  scrollToNativeBottom(): void {
    const container = this.options.registry.snapshot().scrollContainer

    if (!container) {
      return
    }

    this.writeProgrammaticScroll(
      container,
      Math.max(0, container.scrollHeight - container.clientHeight),
    )
  }

  writeProgrammaticScroll(container: HTMLElement, scrollTop: number): void {
    this.suppressScrollUntil = this.options.scheduler.now() + 200
    container.scrollTop = scrollTop
  }

  preserveVisualAnchor(anchor: VisualAnchor | null): void {
    if (!anchor) {
      return
    }

    const row = this.options.registry.getRow(anchor.key)
    const container = this.options.registry.snapshot().scrollContainer
    const previousTop = this.rowTopByKey.get(anchor.key)

    if (!row || !container || previousTop === undefined) {
      return
    }

    const delta = row.getBoundingClientRect().top - previousTop

    if (delta !== 0) {
      this.writeProgrammaticScroll(container, container.scrollTop + delta)
    }
  }

  recordRowMetrics(): void {
    const snapshot = this.options.registry.snapshot()
    this.rowTopByKey.clear()

    for (const [key, row] of snapshot.rows) {
      this.rowTopByKey.set(key, row.getBoundingClientRect().top)
    }
  }

  private createEdgeObserver(
    edge: RuntimeEdge,
    element: HTMLElement | null,
  ): IntersectionObserver | null {
    const root = this.options.registry.snapshot().scrollContainer

    if (!element || !root || !this.options.observerFactory) {
      return null
    }

    const observer = this.options.observerFactory.createIntersectionObserver((entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        this.options.scheduler.now() <= this.edgeSourceActiveUntil
      ) {
        this.options.onEdgeIntersect(edge)
      }
    }, {
      root,
      rootMargin: `${resolveEdgeActivationMargin(root.clientHeight)}px 0px`,
    })
    observer.observe(element)
    return observer
  }

  private disconnectEdgeObservers(): void {
    this.beforeIntersectionObserver?.disconnect()
    this.afterIntersectionObserver?.disconnect()
    this.beforeIntersectionObserver = null
    this.afterIntersectionObserver = null
  }
}

function resolveAlignedScrollTop(
  container: HTMLElement,
  rowRect: DOMRect,
  containerRect: DOMRect,
  align: DestinationIntent['align'],
): number {
  const currentTop = container.scrollTop
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const start = currentTop + rowRect.top - containerRect.top
  const end = currentTop + rowRect.bottom - containerRect.bottom
  const center = currentTop +
    (rowRect.top + rowRect.height / 2) -
    (containerRect.top + containerRect.height / 2)

  if (align === 'end') {
    return clampScrollTop(end, maxTop)
  }

  if (align === 'center') {
    return clampScrollTop(center, maxTop)
  }

  if (align === 'nearest') {
    if (rowRect.top >= containerRect.top && rowRect.bottom <= containerRect.bottom) {
      return currentTop
    }

    return clampScrollTop(
      Math.abs(rowRect.top - containerRect.top) <
        Math.abs(rowRect.bottom - containerRect.bottom)
        ? start
        : end,
      maxTop,
    )
  }

  return clampScrollTop(start, maxTop)
}

function clampScrollTop(scrollTop: number, maxTop: number): number {
  return Math.min(Math.max(0, scrollTop), maxTop)
}

function resolveEdgeActivationMargin(clientHeight: number): number {
  return Math.min(Math.max(clientHeight * 0.25, 64), 240)
}
