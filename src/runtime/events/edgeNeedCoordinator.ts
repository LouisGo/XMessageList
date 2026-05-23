import type { DomRegistry } from '../dom/domRegistry'
import type { ProjectionCoordinator } from '../core/projection/projectionCoordinator'
import type { ProjectionStore } from '../core/state/projectionStore'
import type {
  ScrollFrameMetrics,
} from '../core/state/runtimeTypes'
import type {
  MessageDataSnapshot,
  MessageViewportSnapshot,
  MessageViewportRuntimeEvent,
  RuntimeObserverFactory,
  ScrollSource,
  ViewportEdge,
  ViewportEdgeStatus,
  ViewportEffect,
  ViewportModifier,
} from '../types'
import {
  areRuntimeItemKeysEqual,
  getRuntimeItemKey,
} from '../shared/utils'

export class EdgeNeedCoordinator<TMessage, TOptimistic> {
  private beforeEdgeRequestRevision: number | null = null

  private afterEdgeRequestRevision: number | null = null

  private intersectionObserver: IntersectionObserver | null = null

  constructor(
    private readonly registry: DomRegistry,
    private readonly store: ProjectionStore<TMessage, TOptimistic>,
    private readonly projection: ProjectionCoordinator<TMessage, TOptimistic>,
    private readonly observerFactory: RuntimeObserverFactory,
    private readonly edgeLoadThresholdPx: number,
    private readonly getDataSnapshot: () =>
      | MessageDataSnapshot<TMessage, TOptimistic>
      | null,
    private readonly getLastScrollSource: () => ScrollSource | null,
    private readonly canEmitEdgeNeeds: () => boolean,
    private readonly hasPendingFollowBottom: () => boolean,
    private readonly canPublishEdgeState: () => boolean,
    private readonly emitEvent: (event: MessageViewportRuntimeEvent) => void,
  ) {}

  private edgeProjectionDirty = false

  resetLatches(): void {
    this.beforeEdgeRequestRevision = null
    this.afterEdgeRequestRevision = null
    this.projection.clearEdgeStatuses()
  }

  setAfterEdgeLatched(value: boolean): void {
    this.afterEdgeRequestRevision = value
      ? this.store.getSnapshot().revision
      : null
  }

  setEdgeStatus(edge: ViewportEdge, status: ViewportEdgeStatus): void {
    if (!this.projection.setEdgeStatus(edge, status)) {
      return
    }

    this.requestCurrentEdgeStatePublish()
  }

  flushDeferredEdgeState(): void {
    if (!this.edgeProjectionDirty) {
      return
    }

    this.publishCurrentEdgeState()
  }

  flushCurrentEdgeState(): void {
    if (!this.edgeProjectionDirty && !this.projection.hasEdgeStatusOverrides()) {
      return
    }

    this.publishCurrentEdgeState()
  }

  resolveDataSnapshot(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    modifier: ViewportModifier | ViewportEffect,
  ): void {
    if (!data.hasMoreBefore || modifier === 'prepend' || modifier === 'reset') {
      this.projection.clearEdgeStatus('before')
    }

    if (
      !data.hasMoreAfter ||
      modifier === 'append' ||
      modifier === 'auto-scroll-to-bottom' ||
      modifier === 'reset'
    ) {
      this.projection.clearEdgeStatus('after')
    }
  }

  disconnect(): void {
    this.intersectionObserver?.disconnect()
    this.intersectionObserver = null
  }

  setupIntersectionObserver(container: HTMLElement): void {
    this.disconnect()
    this.intersectionObserver = this.observerFactory.createIntersectionObserver(
      (entries) => this.handleIntersectionEntries(entries),
      {
        root: container,
        rootMargin: `${this.edgeLoadThresholdPx}px 0px`,
        threshold: 0,
      },
    )
    this.observeSentinels()
  }

  observeSentinels(): void {
    if (!this.intersectionObserver) {
      return
    }

    const top = this.registry.getTopSentinel()
    const bottom = this.registry.getBottomSentinel()

    if (top) {
      this.intersectionObserver.observe(top)
    }

    if (bottom) {
      this.intersectionObserver.observe(bottom)
    }
  }

  emitEdgeNeeds(input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    metrics: ScrollFrameMetrics
    scrollSource: ScrollSource
    lastUserScrollTop: number
    lastUserDistanceToBottom: number
  }): void {
    const { data, metrics, scrollSource } = input

    if (!this.canEmitEdgeNeeds()) {
      return
    }

    const nearTop =
      this.isAtBeforeDataEdge() &&
      metrics.scrollTop <= this.edgeLoadThresholdPx
    const distanceToBottom = metrics.distanceToBottom
    const nearBottom =
      this.isAtAfterDataEdge(data) &&
      distanceToBottom <= this.edgeLoadThresholdPx

    const topReleaseThreshold = this.edgeLoadThresholdPx * 3
    const bottomReleaseThreshold = this.edgeLoadThresholdPx * 3
    const userMovedDownAwayFromTop =
      scrollSource === 'user' &&
      metrics.scrollTop > topReleaseThreshold &&
      metrics.scrollTop >= input.lastUserScrollTop
    const userMovedUpAwayFromBottom =
      scrollSource === 'user' &&
      distanceToBottom > bottomReleaseThreshold &&
      distanceToBottom >= input.lastUserDistanceToBottom

    // latch 只在用户明确离开边界后释放；否则停在边界附近会把同一页请求打爆。
    if (userMovedDownAwayFromTop) {
      this.beforeEdgeRequestRevision = null
    }

    if (userMovedUpAwayFromBottom) {
      this.afterEdgeRequestRevision = null
    }

    // 历史分页是用户接近数据边界的意图，不能由 followBottom / recovery 等
    // runtime 写入 scrollTop 的副作用触发，否则短列表吸底时会误拉历史。
    if (!this.canEmitEdgeNeedForSource(scrollSource)) {
      return
    }

    if (
      nearTop &&
      data.hasMoreBefore &&
      this.beforeEdgeRequestRevision !== data.revision
    ) {
      this.beforeEdgeRequestRevision = data.revision
      this.markEdgeLoading('before')
      this.emitEvent({
        type: 'needMoreBefore',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'near-top',
      })
    }

    if (
      nearBottom &&
      data.hasMoreAfter &&
      !this.hasPendingFollowBottom() &&
      this.afterEdgeRequestRevision !== data.revision
    ) {
      this.afterEdgeRequestRevision = data.revision
      this.markEdgeLoading('after')
      this.emitEvent({
        type: 'needMoreAfter',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'near-bottom',
      })
    }
  }

  canEmitEdgeNeedForSource(source: ScrollSource | null): boolean {
    return source === 'user' || source === 'momentum'
  }

  emitScrollbarDragEdgeNeed(input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    edge: 'before' | 'after'
  }): void {
    if (!this.canEmitEdgeNeeds()) {
      return
    }

    const { data, edge } = input

    if (
      edge === 'before' &&
      data.hasMoreBefore &&
      this.beforeEdgeRequestRevision !== data.revision
    ) {
      this.beforeEdgeRequestRevision = data.revision
      this.markEdgeLoading('before')
      this.emitEvent({
        type: 'needMoreBefore',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'near-top',
      })
    }

    if (
      edge === 'after' &&
      data.hasMoreAfter &&
      !this.hasPendingFollowBottom() &&
      this.afterEdgeRequestRevision !== data.revision
    ) {
      this.afterEdgeRequestRevision = data.revision
      this.markEdgeLoading('after')
      this.emitEvent({
        type: 'needMoreAfter',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'near-bottom',
      })
    }
  }

  isAtBeforeDataEdge(): boolean {
    return this.store.getSnapshot().renderWindow.startIndex === 0
  }

  isAtAfterDataEdge(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    return this.store.getSnapshot().renderWindow.endIndex >= data.items.length - 1
  }

  private handleIntersectionEntries(entries: IntersectionObserverEntry[]): void {
    const data = this.getDataSnapshot()

    if (!data) {
      return
    }

    if (
      !this.canEmitEdgeNeeds() ||
      !this.canEmitEdgeNeedForSource(this.getLastScrollSource())
    ) {
      return
    }

    // IntersectionObserver 是兜底触发器；仍然复用 latch 和数据边界判断，避免绕过 scroll path 规则。
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue
      }

      if (
        entry.target === this.registry.getTopSentinel() &&
        data.hasMoreBefore &&
        this.isAtBeforeDataEdge() &&
        this.beforeEdgeRequestRevision !== data.revision
      ) {
        this.beforeEdgeRequestRevision = data.revision
        this.markEdgeLoading('before')
        this.emitEvent({
          type: 'needMoreBefore',
          feedId: data.feedId,
          generation: data.generation,
          reason: 'near-top',
        })
      }

      if (
        entry.target === this.registry.getBottomSentinel() &&
        data.hasMoreAfter &&
        !this.hasPendingFollowBottom() &&
        this.isAtAfterDataEdge(data) &&
        this.afterEdgeRequestRevision !== data.revision
      ) {
        this.afterEdgeRequestRevision = data.revision
        this.markEdgeLoading('after')
        this.emitEvent({
          type: 'needMoreAfter',
          feedId: data.feedId,
          generation: data.generation,
          reason: 'near-bottom',
        })
      }
    }
  }

  private markEdgeLoading(edge: ViewportEdge): void {
    if (!this.projection.setEdgeStatus(edge, 'loading')) {
      return
    }

    this.requestCurrentEdgeStatePublish()
  }

  private requestCurrentEdgeStatePublish(): void {
    this.edgeProjectionDirty = true
    this.publishCurrentEdgeState()
  }

  private publishCurrentEdgeState(): void {
    const data = this.getDataSnapshot()

    if (!data || !this.canPublishEdgeState()) {
      return
    }

    const snapshot = this.store.getSnapshot()

    if (!this.isCurrentProjectionAligned(data, snapshot)) {
      return
    }

    this.projection.publish({
      data,
      renderWindow: snapshot.renderWindow,
      bootstrapState: snapshot.bootstrapState,
      bottomLockState: snapshot.bottomLockState,
      viewportPhase: snapshot.viewportPhase,
      topSpacer: snapshot.topSpacer,
      bottomSpacer: snapshot.bottomSpacer,
    })
    this.edgeProjectionDirty = false
  }

  private isCurrentProjectionAligned(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ): boolean {
    const { renderWindow } = snapshot

    if (renderWindow.itemKeys.length === 0) {
      return data.items.length === 0
    }

    if (
      renderWindow.startIndex < 0 ||
      renderWindow.endIndex >= data.items.length ||
      renderWindow.itemKeys.length !==
        renderWindow.endIndex - renderWindow.startIndex + 1
    ) {
      return false
    }

    return renderWindow.itemKeys.every((key, index) => {
      const item = data.items[renderWindow.startIndex + index]

      return Boolean(item) && areRuntimeItemKeysEqual(key, getRuntimeItemKey(item))
    })
  }
}
