import {
  findKeyForAnchor,
} from '../shared/snapshotIdentity'
import type { RuntimeDomRegistry } from './domRegistry'
import { DirectScrollSession } from '../scroll/directScrollSession'
import type { ViewportDiagnosticRecord } from '../contracts/events'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { RuntimeMeasurement, VisualAnchor } from './measurement'
import type { RuntimeObserverFactory, RuntimeScheduler } from '../contracts/options'
import type { SegmentModifier } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { DestinationIntent, RuntimeEdge } from '../interactions/interactionState'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import {
  RuntimeRowMetricCache,
  type RuntimeMeasurementCacheContext,
  type RuntimeSegmentSizeSnapshot,
} from './rowMetricCache'

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

/**
 * RuntimeDomInteractions 是 viewport runtime 唯一的 DOM I/O 层，集中处理测量、scrollTop 写入和 edge trigger 观察。
 */
export class RuntimeDomInteractions<TMessage, TOptimistic> {
  private beforeIntersectionObserver: IntersectionObserver | null = null
  private afterIntersectionObserver: IntersectionObserver | null = null
  private edgeSourceActiveUntil = 0
  private suppressScrollUntil = 0
  private scrollFrame: number | null = null

  private readonly directScroll = new DirectScrollSession()

  private readonly rowMetrics: RuntimeRowMetricCache

  private detachedScrollTop: number | null = null

  private lastKnownScrollTop = 0

  private attachRestoreFrame: number | null = null

  private pendingAttachRestore: {
    container: HTMLElement
    scrollTop: number
  } | null = null

  private readonly handleScroll = (): void => {
    const now = this.options.scheduler.now()

    if (now < this.suppressScrollUntil) {
      return
    }

    this.cancelAttachRestore()
    this.rememberScrollTop()
    this.markEdgeSourceActive(now)
    // 先登记 frame 再广播 navigation intent；同步 listener 中的 safety probe
    // 也必须看见“滚动尚未结算”，不能利用回调重入窗口修改 topology。
    this.scheduleScrollFrame()
    this.options.onUserScrollIntent()
  }

  private readonly handleUserScrollInput = (): void => {
    const now = this.options.scheduler.now()
    this.cancelAttachRestore()
    this.markEdgeSourceActive(now)
    this.scheduleScrollFrame()
    this.options.onUserScrollIntent()
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
      // warm attach 先恢复上次 scrollTop，下一帧再按新 scrollHeight clamp，减少切 session 白屏跳动。
      this.restoreDetachedScrollTop(container, this.detachedScrollTop)
    } else {
      this.lastKnownScrollTop = container.scrollTop
    }
    container.addEventListener('scroll', this.handleScroll, { passive: true })
    container.addEventListener('wheel', this.handleUserScrollInput, { passive: true })
    container.addEventListener('touchstart', this.handleUserScrollInput, { passive: true })
    container.addEventListener('pointerdown', this.handleUserScrollInput, { passive: true })
    this.reconnectEdgeObservers()
  }

  detachScrollContainer(): void {
    this.cancelAttachRestore()
    const container = this.options.registry.snapshot().scrollContainer
    this.detachedScrollTop = container
      ? this.resolveDetachScrollTop(container)
      : this.detachedScrollTop
    container?.removeEventListener(
      'scroll',
      this.handleScroll,
    )
    container?.removeEventListener('wheel', this.handleUserScrollInput)
    container?.removeEventListener('touchstart', this.handleUserScrollInput)
    container?.removeEventListener('pointerdown', this.handleUserScrollInput)
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

  hasPendingScrollFrame(): boolean { return this.scrollFrame !== null || this.attachRestoreFrame !== null }
  isDirectScrollActive(): boolean { return this.directScroll.snapshot().status !== 'IDLE' }

  beginDirectScroll(): void {
    this.cancelAttachRestore()
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

    this.cancelAttachRestore()
    this.scheduleScrollFrame()
    this.options.onUserScrollIntent()
    this.markEdgeSourceActive(this.options.scheduler.now())
    // 直接滚动写入也要记录 edge intent，拖拽到边缘后由 post-commit 阶段统一发 needMore。
    const edgeIntent = resolveDirectScrollEdgeIntent(
      scrollTop,
      container,
      this.options.edgeActivationMarginPx,
    )
    const session = this.directScroll.recordWrite(edgeIntent)
    this.emitDirectScrollDiagnostic('write', session, { scrollTop })
    container.scrollTop = scrollTop
    this.lastKnownScrollTop = container.scrollTop
    return true
  }

  endDirectScroll(): void {
    const session = this.directScroll.end()
    // end 先登记最后一帧；同步 listener 必须等实时测量完成后才能修改 topology。
    this.scheduleScrollFrame()
    this.emitDirectScrollDiagnostic('end', session)
    this.options.onUserScrollIntent()
    this.markEdgeSourceActive(this.options.scheduler.now())
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
    source: ScrollSource = 'programmatic',
  ): boolean {
    const resolved = this.resolveAlignedScrollTarget(snapshot, target, align, offsetWithinMessage)

    if (!resolved) {
      return false
    }

    this.writeProgrammaticScroll(resolved.container, resolved.scrollTop, source)
    return true
  }

  resolveAlignedScrollTarget(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    target: MessageIdentityAnchor,
    align: DestinationIntent['align'],
    offsetWithinMessage?: number,
  ): { container: HTMLElement; scrollTop: number } | null {
    const key = findKeyForAnchor(snapshot, target)
    const container = this.options.registry.snapshot().scrollContainer
    const row = key ? this.options.registry.getRow(key) : null

    if (!row || !container) {
      return null
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

    return { container, scrollTop: nextTop }
  }

  getBottomTargetTop(): number | null {
    const container = this.options.registry.snapshot().scrollContainer

    if (!container) {
      return null
    }

    return Math.max(0, container.scrollHeight - container.clientHeight)
  }

  getScrollContainer(): HTMLElement | null {
    return this.options.registry.snapshot().scrollContainer
  }

  scrollToNativeBottom(source: ScrollSource = 'followBottom'): boolean {
    const container = this.options.registry.snapshot().scrollContainer

    if (!container) {
      return false
    }

    this.writeProgrammaticScroll(
      container,
      Math.max(0, container.scrollHeight - container.clientHeight),
      source,
    )
    return true
  }

  writeProgrammaticScroll(
    container: HTMLElement,
    scrollTop: number,
    source: ScrollSource = 'programmatic',
  ): void {
    this.cancelAttachRestore()
    // 程序性写入会短暂压制原生 scroll 事件，防止 recovery/motion 被误判成用户滚动。
    this.writeSuppressedScroll(container, scrollTop, source)
  }

  preserveVisualAnchor(anchor: VisualAnchor | null): void {
    if (!anchor) {
      return
    }

    const row = this.options.registry.getRow(anchor.key)
    const snapshot = this.options.registry.snapshot()
    const container = snapshot.scrollContainer
    const previousTop = this.rowMetrics.getProjectedTop(anchor.key, snapshot)

    if (!row || !container || previousTop === undefined) {
      return
    }

    const delta = row.getBoundingClientRect().top - previousTop

    if (delta !== 0) {
      this.writeProgrammaticScroll(container, container.scrollTop + delta, 'recovery')
    }
  }

  recordRowMetrics(
    measurement?: RuntimeMeasurement,
    context?: RuntimeMeasurementCacheContext,
  ): void {
    this.rowMetrics.record(this.options.registry.snapshot(), measurement, context)
  }

  getScrollSampleKeys(limit = 32, overscanPx = 160): string[] | undefined {
    return this.rowMetrics.getScrollSampleKeys(
      this.options.registry.snapshot(),
      limit,
      overscanPx,
    )
  }

  markRowMetricDirty(key: string): void {
    this.rowMetrics.markDirty(key)
  }

  markRowMetricDirtyKeys(keys: Iterable<string>): void {
    this.rowMetrics.markDirtyKeys(keys)
  }

  markAllRowMetricsDirty(reason: string): void {
    this.rowMetrics.markAllDirty(reason)
  }

  deleteRowMetric(key: string): void {
    this.rowMetrics.deleteKey(key)
  }

  remapRowMetric(previousKey: string | undefined, nextKey: string): void {
    this.rowMetrics.remapKey(previousKey, nextKey)
  }

  invalidateRowMetricsAfterIndex(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    index: number | null,
    reason: string,
  ): void {
    this.rowMetrics.invalidateAfterIndex(snapshot.items, index, reason)
  }

  invalidateRowMetricsFromIndex(
    items: Array<{ key: string }>,
    index: number,
    reason: string,
  ): void {
    this.rowMetrics.invalidateFromIndex(items, index, reason)
  }

  createSizeSnapshot(input: {
    sessionId: string
    generation: number
    segmentRevision: number
    anchor?: { key: string; offsetWithinMessage: number }
  }): RuntimeSegmentSizeSnapshot {
    return this.rowMetrics.createSizeSnapshot(input)
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
        // IntersectionObserver 只在近期用户/直接滚动活跃时触发加载，避免布局变化自发拉数据。
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

  private restoreDetachedScrollTop(
    container: HTMLElement,
    scrollTop: number,
  ): void {
    this.writeSuppressedScroll(container, scrollTop, 'recovery', {
      remember: false,
    })
    this.rememberRestoredScrollTop(container, scrollTop)
    this.pendingAttachRestore = { container, scrollTop }
    this.attachRestoreFrame = this.options.scheduler.requestAnimationFrame(() => {
      this.attachRestoreFrame = null
      const pending = this.pendingAttachRestore
      this.pendingAttachRestore = null

      if (
        !pending ||
        this.options.registry.snapshot().scrollContainer !== pending.container
      ) {
        return
      }

      const maxScrollTop = Math.max(
        0,
        pending.container.scrollHeight - pending.container.clientHeight,
      )
      const nextTop = Math.min(pending.scrollTop, maxScrollTop)

      if (nextTop > 0 && Math.abs(pending.container.scrollTop - nextTop) > 1) {
        this.writeSuppressedScroll(pending.container, nextTop, 'recovery')
      }
    })
  }

  private resolveDetachScrollTop(container: HTMLElement): number {
    return container.scrollTop === 0 && this.lastKnownScrollTop > 0
      ? this.lastKnownScrollTop
      : container.scrollTop
  }

  private rememberScrollTop(): void {
    const container = this.options.registry.snapshot().scrollContainer

    if (container) {
      this.lastKnownScrollTop = container.scrollTop
    }
  }

  private rememberRestoredScrollTop(
    container: HTMLElement,
    targetScrollTop: number,
  ): void {
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    const expected = Math.min(targetScrollTop, maxScrollTop)

    if (Math.abs(container.scrollTop - expected) <= 1) {
      this.lastKnownScrollTop = container.scrollTop
    }
  }

  private cancelAttachRestore(): void {
    if (this.attachRestoreFrame !== null) {
      this.options.scheduler.cancelAnimationFrame(this.attachRestoreFrame)
    }
    this.attachRestoreFrame = null
    this.pendingAttachRestore = null
  }

  private writeSuppressedScroll(
    container: HTMLElement,
    scrollTop: number,
    source: ScrollSource,
    options: { remember?: boolean } = {},
  ): void {
    this.options.onScrollWrite(source)
    this.suppressScrollUntil = this.options.scheduler.now() + 200
    container.scrollTop = scrollTop
    if (options.remember !== false) {
      this.lastKnownScrollTop = container.scrollTop
    }
    this.scheduleScrollFrame()
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

  if (distanceToBefore <= threshold && distanceToBefore <= distanceToAfter) return 'before'

  if (distanceToAfter <= threshold) {
    return 'after'
  }

  return null
}
