import {
  findKeyForAnchor,
} from '../shared/snapshotIdentity'
import type { RuntimeDomRegistry } from './domRegistry'
import { DirectScrollSession } from '../scroll/directScrollSession'
import type { ViewportDiagnosticRecord } from '../contracts/events'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { VisualAnchor } from './measurement'
import type { RuntimeObserverFactory, RuntimeScheduler } from '../contracts/options'
import type { SegmentModifier } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { DestinationIntent, RuntimeEdge } from '../interactions/interactionState'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import { RuntimeRowMetricCache } from './rowMetricCache'

export type RuntimeDomInteractionsOptions = {
  scheduler: RuntimeScheduler
  observerFactory: RuntimeObserverFactory | null
  registry: RuntimeDomRegistry
  onEdgeIntersect: (edge: RuntimeEdge) => void
  onScrollWrite: (source: ScrollSource) => void
  onUserScrollIntent: () => void
  onScrollFrame: () => void
  edgeActivationMarginPx?: number
  onDiagnostic: (
    name: string,
    severity: ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ) => void
}

export class RuntimeDomInteractions<TMessage, TOptimistic> {
  private beforeIntersectionObserver: IntersectionObserver | null = null

  private afterIntersectionObserver: IntersectionObserver | null = null

  private edgeSourceActiveUntil = 0

  private suppressScrollUntil = 0

  private scrollFrame: number | null = null

  private readonly directScroll = new DirectScrollSession()

  private readonly rowMetrics: RuntimeRowMetricCache

  private detachedScrollTop: number | null = null

  private readonly handleScroll = (): void => {
    const now = this.options.scheduler.now()

    if (now < this.suppressScrollUntil) {
      return
    }

    this.markEdgeSourceActive(now)
    this.options.onUserScrollIntent()
    this.scheduleScrollFrame()
  }

  constructor(private readonly options: RuntimeDomInteractionsOptions) {
    this.rowMetrics = new RuntimeRowMetricCache({
      scheduler: options.scheduler,
      onDiagnostic: options.onDiagnostic,
    })
  }

  attachScrollContainer(container: HTMLElement): void {
    this.options.registry.snapshot().scrollContainer?.removeEventListener(
      'scroll',
      this.handleScroll,
    )
    this.disconnectEdgeObservers()
    this.options.registry.setScrollContainer(container)
    if (this.detachedScrollTop !== null) {
      this.options.onScrollWrite('recovery')
      this.suppressScrollUntil = this.options.scheduler.now() + 200
      container.scrollTop = this.detachedScrollTop
    }
    container.addEventListener('scroll', this.handleScroll, { passive: true })
    this.reconnectEdgeObservers()
  }

  detachScrollContainer(): void {
    const container = this.options.registry.snapshot().scrollContainer
    this.detachedScrollTop = container?.scrollTop ?? this.detachedScrollTop
    container?.removeEventListener(
      'scroll',
      this.handleScroll,
    )
    this.disconnectEdgeObservers()
    if (this.scrollFrame !== null) {
      this.options.scheduler.cancelAnimationFrame(this.scrollFrame)
    }
    this.scrollFrame = null
    this.directScroll.end()
    this.rowMetrics.clear()
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
    const session = this.directScroll.begin()
    this.emitDirectScrollDiagnostic('begin', session)
    this.options.onUserScrollIntent()
    this.markEdgeSourceActive(this.options.scheduler.now())
  }

  writeDirectScrollTop(scrollTop: number): boolean {
    const container = this.options.registry.snapshot().scrollContainer

    if (!container) {
      return false
    }

    this.options.onUserScrollIntent()
    this.markEdgeSourceActive(this.options.scheduler.now())
    const edgeIntent = resolveDirectScrollEdgeIntent(
      scrollTop,
      container,
      this.options.edgeActivationMarginPx,
    )
    const session = this.directScroll.recordWrite(edgeIntent)
    this.emitDirectScrollDiagnostic('write', session, { scrollTop })
    container.scrollTop = scrollTop
    this.scheduleScrollFrame()
    return true
  }

  endDirectScroll(): void {
    const session = this.directScroll.end()
    this.emitDirectScrollDiagnostic('end', session)
    this.options.onUserScrollIntent()
    this.markEdgeSourceActive(this.options.scheduler.now())
    this.scheduleScrollFrame()
  }

  getDirectScrollEdgeIntent(): RuntimeEdge | null { return this.directScroll.getConsumableEdgeIntent() }
  consumeDirectScrollEdgeIntent(edge: RuntimeEdge, requestToken: string): void { const session = this.directScroll.markEdgeConsumed(edge, requestToken); if (session) this.emitDirectScrollDiagnostic('edgeConsumed', session) }
  settleDirectScrollSegment(modifier: SegmentModifier): void { this.directScroll.settleSegment(modifier) }
  notifyDirectScrollRebased(): void { const session = this.directScroll.markRebased(); if (session) this.emitDirectScrollDiagnostic('rebased', session) }

  alignToMessage(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    target: MessageIdentityAnchor,
    align: DestinationIntent['align'],
    offsetWithinMessage?: number,
  ): boolean {
    const key = findKeyForAnchor(snapshot, target)
    const container = this.options.registry.snapshot().scrollContainer
    const row = key ? this.options.registry.getRow(key) : null

    if (!row || !container) {
      return false
    }

    const containerRect = container.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const nextTop = resolveAlignedScrollTop(
      container,
      rowRect,
      containerRect,
      align,
      offsetWithinMessage,
    )
    this.writeProgrammaticScroll(container, nextTop, 'jump')
    return true
  }

  scrollToNativeBottom(source: ScrollSource = 'followBottom'): void {
    const container = this.options.registry.snapshot().scrollContainer

    if (!container) {
      return
    }

    this.writeProgrammaticScroll(
      container,
      Math.max(0, container.scrollHeight - container.clientHeight),
      source,
    )
  }

  writeProgrammaticScroll(
    container: HTMLElement,
    scrollTop: number,
    source: ScrollSource = 'programmatic',
  ): void {
    this.options.onScrollWrite(source)
    this.suppressScrollUntil = this.options.scheduler.now() + 200
    container.scrollTop = scrollTop
    this.scheduleScrollFrame()
  }

  preserveVisualAnchor(anchor: VisualAnchor | null): void {
    if (!anchor) {
      return
    }

    const row = this.options.registry.getRow(anchor.key)
    const container = this.options.registry.snapshot().scrollContainer
    const previousTop = this.rowMetrics.getTop(anchor.key)

    if (!row || !container || previousTop === undefined) {
      return
    }

    const delta = row.getBoundingClientRect().top - previousTop

    if (delta !== 0) {
      this.writeProgrammaticScroll(container, container.scrollTop + delta, 'recovery')
    }
  }

  recordRowMetrics(): void {
    this.rowMetrics.record(this.options.registry.snapshot())
  }

  getScrollSampleKeys(limit = 32, overscanPx = 160): string[] | undefined {
    return this.rowMetrics.getScrollSampleKeys(
      this.options.registry.snapshot(),
      limit,
      overscanPx,
    )
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
        this.isEdgeSourceActive()
      ) {
        this.options.onEdgeIntersect(edge)
      }
    }, {
      root,
      rootMargin: `${resolveEdgeActivationMargin(
        root.clientHeight,
        this.options.edgeActivationMarginPx,
      )}px 0px`,
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

  private reconnectEdgeObservers(): void {
    const snapshot = this.options.registry.snapshot()
    this.beforeIntersectionObserver = this.createEdgeObserver(
      'before',
      snapshot.beforeTrigger,
    )
    this.afterIntersectionObserver = this.createEdgeObserver(
      'after',
      snapshot.afterTrigger,
    )
  }

  private markEdgeSourceActive(now: number): void {
    this.edgeSourceActiveUntil = now + 200
  }

  private isEdgeSourceActive(): boolean {
    return this.directScroll.snapshot().status !== 'IDLE' ||
      this.options.scheduler.now() <= this.edgeSourceActiveUntil
  }

  private scheduleScrollFrame(): void {
    if (this.scrollFrame !== null) {
      return
    }

    this.scrollFrame = this.options.scheduler.requestAnimationFrame(() => {
      this.scrollFrame = null
      this.options.onScrollFrame()
    })
  }

  private emitDirectScrollDiagnostic(
    action: string,
    session: ReturnType<DirectScrollSession['snapshot']>,
    details: Record<string, unknown> = {},
  ): void {
    this.options.onDiagnostic(`directScroll.${action}`, 'debug', {
      ...details,
      sessionStatus: session.status,
      edgeIntent: session.edgeIntent,
      edge: 'edge' in session ? session.edge : undefined,
    })
  }
}

function resolveAlignedScrollTop(
  container: HTMLElement,
  rowRect: DOMRect,
  containerRect: DOMRect,
  align: DestinationIntent['align'],
  offsetWithinMessage?: number,
): number {
  const currentTop = container.scrollTop
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const start = currentTop + rowRect.top - containerRect.top
  const offsetStart = typeof offsetWithinMessage === 'number'
    ? start + Math.max(0, offsetWithinMessage)
    : null
  const end = currentTop + rowRect.bottom - containerRect.bottom
  const center = currentTop +
    (rowRect.top + rowRect.height / 2) -
    (containerRect.top + containerRect.height / 2)

  if (offsetStart !== null) {
    return clampScrollTop(offsetStart, maxTop)
  }

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

function resolveEdgeActivationMargin(
  clientHeight: number,
  configuredMarginPx?: number,
): number {
  return configuredMarginPx ?? Math.min(Math.max(clientHeight * 0.25, 64), 240)
}

function resolveDirectScrollEdgeIntent(
  scrollTop: number,
  container: HTMLElement,
  edgeActivationMarginPx?: number,
): RuntimeEdge | null {
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const threshold = resolveEdgeActivationMargin(
    container.clientHeight,
    edgeActivationMarginPx,
  )
  const distanceToBefore = scrollTop
  const distanceToAfter = maxScrollTop - scrollTop

  if (
    distanceToBefore <= threshold &&
    distanceToBefore <= distanceToAfter
  ) {
    return 'before'
  }

  if (distanceToAfter <= threshold) {
    return 'after'
  }

  return null
}
