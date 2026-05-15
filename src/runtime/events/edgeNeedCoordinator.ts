import type { DomRegistry } from '../dom/domRegistry'
import type { ProjectionStore } from '../core/projectionStore'
import type {
  MessageDataSnapshot,
  MessageViewportRuntimeEvent,
  RuntimeObserverFactory,
  ScrollSource,
} from '../types'
import { getDistanceToBottom } from '../shared/utils'

export class EdgeNeedCoordinator<TMessage, TOptimistic> {
  private beforeEdgeRequestLatched = false

  private afterEdgeRequestLatched = false

  private intersectionObserver: IntersectionObserver | null = null

  constructor(
    private readonly registry: DomRegistry,
    private readonly store: ProjectionStore<TMessage, TOptimistic>,
    private readonly observerFactory: RuntimeObserverFactory,
    private readonly edgeLoadThresholdPx: number,
    private readonly getDataSnapshot: () =>
      | MessageDataSnapshot<TMessage, TOptimistic>
      | null,
    private readonly getLastScrollSource: () => ScrollSource | null,
    private readonly canEmitEdgeNeeds: () => boolean,
    private readonly hasPendingFollowBottom: () => boolean,
    private readonly emitEvent: (event: MessageViewportRuntimeEvent) => void,
  ) {}

  resetLatches(): void {
    this.beforeEdgeRequestLatched = false
    this.afterEdgeRequestLatched = false
  }

  setAfterEdgeLatched(value: boolean): void {
    this.afterEdgeRequestLatched = value
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
    container: HTMLElement
    data: MessageDataSnapshot<TMessage, TOptimistic>
    scrollSource: ScrollSource
    lastUserScrollTop: number
    lastUserDistanceToBottom: number
  }): void {
    const { container, data, scrollSource } = input

    if (!this.canEmitEdgeNeeds()) {
      return
    }

    const nearTop =
      this.isAtBeforeDataEdge() &&
      container.scrollTop <= this.edgeLoadThresholdPx
    const distanceToBottom = getDistanceToBottom(container)
    const nearBottom =
      this.isAtAfterDataEdge(data) &&
      distanceToBottom <= this.edgeLoadThresholdPx

    const topReleaseThreshold = this.edgeLoadThresholdPx * 3
    const bottomReleaseThreshold = this.edgeLoadThresholdPx * 3
    const userMovedDownAwayFromTop =
      scrollSource === 'user' &&
      container.scrollTop > topReleaseThreshold &&
      container.scrollTop >= input.lastUserScrollTop
    const userMovedUpAwayFromBottom =
      scrollSource === 'user' &&
      distanceToBottom > bottomReleaseThreshold &&
      distanceToBottom >= input.lastUserDistanceToBottom

    // latch 只在用户明确离开边界后释放；否则停在边界附近会把同一页请求打爆。
    if (userMovedDownAwayFromTop) {
      this.beforeEdgeRequestLatched = false
    }

    if (userMovedUpAwayFromBottom) {
      this.afterEdgeRequestLatched = false
    }

    // 历史分页是用户接近数据边界的意图，不能由 followBottom / recovery 等
    // runtime 写入 scrollTop 的副作用触发，否则短列表吸底时会误拉历史。
    if (!this.canEmitEdgeNeedForSource(scrollSource)) {
      return
    }

    if (nearTop && data.hasMoreBefore && !this.beforeEdgeRequestLatched) {
      this.beforeEdgeRequestLatched = true
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
      !this.afterEdgeRequestLatched
    ) {
      this.afterEdgeRequestLatched = true
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
        !this.beforeEdgeRequestLatched
      ) {
        this.beforeEdgeRequestLatched = true
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
        !this.afterEdgeRequestLatched
      ) {
        this.afterEdgeRequestLatched = true
        this.emitEvent({
          type: 'needMoreAfter',
          feedId: data.feedId,
          generation: data.generation,
          reason: 'near-bottom',
        })
      }
    }
  }
}
