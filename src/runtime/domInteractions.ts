import {
  findKeyForAnchor,
} from './controllerHelpers'
import type { RuntimeDomRegistry } from './domRegistry'
import { DirectScrollSession } from './directScrollSession'
import type { ViewportDiagnosticRecord } from './events'
import type { MessageIdentityAnchor, MessageRuntimeItemKey } from './identity'
import type { VisualAnchor } from './measurement'
import type { RuntimeObserverFactory, RuntimeScheduler } from './options'
import type { SegmentModifier } from './segment'
import type { MessageListSnapshot } from './snapshot'
import type { DestinationIntent, RuntimeEdge } from './interactionState'
import type { ScrollSource } from './scrollIntentEngine'

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

  private readonly rowMetricsByKey = new Map<
    MessageRuntimeItemKey,
    RowMetric
  >()

  private rowMetricOrder: RowMetric[] = []

  private rowMetricsScrollTop = 0

  private lastMetricRecordAt: number | null = null

  private readonly handleScroll = (): void => {
    const now = this.options.scheduler.now()

    if (now < this.suppressScrollUntil) {
      return
    }

    this.markEdgeSourceActive(now)
    this.options.onUserScrollIntent()
    this.scheduleScrollFrame()
  }

  constructor(private readonly options: RuntimeDomInteractionsOptions) {}

  attachScrollContainer(container: HTMLElement): void {
    this.options.registry.snapshot().scrollContainer?.removeEventListener(
      'scroll',
      this.handleScroll,
    )
    this.disconnectEdgeObservers()
    this.options.registry.setScrollContainer(container)
    container.addEventListener('scroll', this.handleScroll, { passive: true })
    this.reconnectEdgeObservers()
  }

  detachScrollContainer(): void {
    this.options.registry.snapshot().scrollContainer?.removeEventListener(
      'scroll',
      this.handleScroll,
    )
    this.disconnectEdgeObservers()
    if (this.scrollFrame !== null) {
      this.options.scheduler.cancelAnimationFrame(this.scrollFrame)
    }
    this.scrollFrame = null
    this.directScroll.end()
    this.clearRowMetrics()
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
    const previousTop = this.rowMetricsByKey.get(anchor.key)?.top

    if (!row || !container || previousTop === undefined) {
      return
    }

    const delta = row.getBoundingClientRect().top - previousTop

    if (delta !== 0) {
      this.writeProgrammaticScroll(container, container.scrollTop + delta, 'recovery')
    }
  }

  recordRowMetrics(): void {
    const snapshot = this.options.registry.snapshot()
    const previousKeys = new Set(this.rowMetricsByKey.keys())
    let hits = 0
    let misses = 0

    this.clearRowMetrics()
    this.rowMetricsScrollTop = snapshot.scrollContainer?.scrollTop ?? 0

    for (const [key, row] of snapshot.rows) {
      const rect = row.getBoundingClientRect()
      if (previousKeys.delete(key)) {
        hits += 1
      } else {
        misses += 1
      }
      const metric: RowMetric = {
        key,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      }
      this.rowMetricsByKey.set(key, metric)
      this.rowMetricOrder.push(metric)
    }
    this.rowMetricOrder.sort((first, second) => first.top - second.top)

    this.emitMeasurementCacheDiagnostics({
      hits,
      misses,
      invalidated: previousKeys.size,
      rowCount: snapshot.rows.size,
    })
    this.emitBlankAreaSample(snapshot)
    this.emitFrameGapSample()
  }

  getScrollSampleKeys(limit = 32, overscanPx = 160): string[] | undefined {
    const snapshot = this.options.registry.snapshot()
    const container = snapshot.scrollContainer

    if (!container || this.rowMetricsByKey.size === 0) {
      return undefined
    }

    const containerRect = container.getBoundingClientRect()
    const scrollDelta = container.scrollTop - this.rowMetricsScrollTop
    const viewportStart = containerRect.top + scrollDelta
    const viewportEnd = containerRect.bottom + scrollDelta
    const sampleStart = viewportStart - overscanPx
    const sampleEnd = viewportEnd + overscanPx
    const visibleStartIndex = findFirstMetricEndingAfter(
      this.rowMetricOrder,
      viewportStart,
    )
    const visibleKeys: string[] = []
    const nearKeys: string[] = []
    let visibleEndIndex = visibleStartIndex

    for (let index = visibleStartIndex; index < this.rowMetricOrder.length; index += 1) {
      const metric = this.rowMetricOrder[index]
      if (metric.top > viewportEnd) {
        break
      }

      visibleKeys.push(metric.key)
      visibleEndIndex = index + 1

      if (visibleKeys.length >= limit) {
        return visibleKeys
      }
    }

    if (visibleKeys.length === 0) {
      return collectMetricWindow(this.rowMetricOrder, sampleStart, sampleEnd, limit)
    }

    for (
      let index = visibleStartIndex - 1;
      index >= 0 && visibleKeys.length + nearKeys.length < limit;
      index -= 1
    ) {
      const metric = this.rowMetricOrder[index]
      if (metric.bottom < sampleStart) {
        break
      }
      nearKeys.unshift(metric.key)
    }

    for (
      let index = visibleEndIndex;
      index < this.rowMetricOrder.length &&
        visibleKeys.length + nearKeys.length < limit;
      index += 1
    ) {
      const metric = this.rowMetricOrder[index]
      if (metric.top > sampleEnd) {
        break
      }
      nearKeys.push(metric.key)
    }

    return [...visibleKeys, ...nearKeys].slice(0, limit)
  }

  private clearRowMetrics(): void {
    this.rowMetricsByKey.clear()
    this.rowMetricOrder = []
    this.rowMetricsScrollTop = 0
  }

  private emitMeasurementCacheDiagnostics(input: {
    hits: number
    misses: number
    invalidated: number
    rowCount: number
  }): void {
    if (input.hits > 0) {
      this.options.onDiagnostic('measurement.cache.hit', 'debug', input)
    }
    if (input.misses > 0) {
      this.options.onDiagnostic('measurement.cache.miss', 'info', input)
    }
    if (input.invalidated > 0) {
      this.options.onDiagnostic('measurement.cache.invalidate', 'info', input)
    }
  }

  private emitBlankAreaSample(snapshot: ReturnType<RuntimeDomRegistry['snapshot']>): void {
    const container = snapshot.scrollContainer

    if (!container) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const rowRects = Array.from(snapshot.rows.values(), (row) =>
      row.getBoundingClientRect(),
    )
    const first = rowRects[0]
    const last = rowRects.at(-1)
    this.options.onDiagnostic('blank-area.sample', 'debug', {
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      rowCount: rowRects.length,
      blankBefore: first ? Math.max(0, first.top - containerRect.top) : 0,
      blankAfter: last ? Math.max(0, containerRect.bottom - last.bottom) : 0,
    })
  }

  private emitFrameGapSample(): void {
    const now = this.options.scheduler.now()

    if (this.lastMetricRecordAt !== null) {
      this.options.onDiagnostic('frame-gap.sample', 'debug', {
        deltaMs: now - this.lastMetricRecordAt,
      })
    }

    this.lastMetricRecordAt = now
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

type RowMetric = {
  key: MessageRuntimeItemKey
  top: number
  bottom: number
  height: number
}

function collectMetricWindow(
  metrics: RowMetric[],
  start: number,
  end: number,
  limit: number,
): MessageRuntimeItemKey[] {
  const keys: MessageRuntimeItemKey[] = []
  const firstIndex = findFirstMetricEndingAfter(metrics, start)

  for (let index = firstIndex; index < metrics.length; index += 1) {
    const metric = metrics[index]
    if (metric.top > end || keys.length >= limit) {
      break
    }
    keys.push(metric.key)
  }

  return keys
}

function findFirstMetricEndingAfter(
  metrics: RowMetric[],
  threshold: number,
): number {
  let low = 0
  let high = metrics.length

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (metrics[mid].bottom < threshold) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
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
