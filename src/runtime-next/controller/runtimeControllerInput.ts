import type {
  PendingDataIntent,
  PendingSegmentShiftOrigin,
} from '../data/classifier.types'
import type { RuntimeDataStore } from '../data/store'
import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import { getRuntimeAnimationFrame } from '../dom/animationFrame'
import { RuntimeDomInputController } from '../dom/inputController'
import { RuntimeDomObserverController } from '../dom/observerController'
import type { RuntimeNextViewportEvent } from '../events/types'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import type { PhysicalScrollMetrics, SegmentShiftDirection } from '../geometry/types'
import type { PhysicalSegmentRevisionController } from '../geometry/segment/segmentRevision'
import type { MessageRuntimeItemKey } from '../identity/types'
import type { BottomLockState } from '../projection/types'
import type { ProjectionStore } from '../projection/store'
import {
  EdgeNeedLatch,
} from '../scroll/edgeNeedLatch'
import { ScrollInteractionState } from '../scroll/interactionState'
import { ScrollMotionEngine } from '../scroll/motionEngine'
import type { ScrollWriterArbitration } from '../scroll/writerArbitration'
import type {
  RuntimeTransaction,
  RuntimeTransactionIntent,
} from '../transactions/types'
import { hasAdjacentSegmentData } from './controllerHelpers'
import {
  emitAdjacentPrefetchNeed,
  reconcileBottomLockFromMetrics,
  reconcileBottomLockFromScroll,
  resolveAdjacentPrefetchFlags,
  syncAdjacentPrefetchState,
} from './runtimeControllerInputHelpers'
import { handleWheelBoundaryEvent } from './runtimeControllerWheel'

export type RuntimeControllerInputCoordinatorDeps<
  TMessage,
  TOptimistic,
> = {
  readonly feedId: string
  readonly generation: number
  readonly data: RuntimeDataStore<TMessage, TOptimistic>
  readonly dom: RuntimeDomRegistry
  readonly metrics: PhysicalMetricsStore
  readonly revision: PhysicalSegmentRevisionController
  readonly writer: ScrollWriterArbitration
  readonly diagnostics: DiagnosticRecorder
  readonly projection: ProjectionStore<TMessage, TOptimistic>
  readonly getDestroyed: () => boolean
  readonly setBottomLockState: (state: BottomLockState) => void
  readonly setCurrentScrollTop: (scrollTop: number) => void
  readonly getCurrentScrollTop: () => number
  readonly enqueue: (
    intent: RuntimeTransactionIntent<TMessage, TOptimistic>,
  ) => void
  readonly setPendingDataIntent: (intent: PendingDataIntent) => void
  readonly emitNeedForPendingIntent: (intent: PendingDataIntent) => void
  readonly emitEvent: (event: RuntimeNextViewportEvent) => void
}

export class RuntimeControllerInputCoordinator<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  readonly #deps: RuntimeControllerInputCoordinatorDeps<TMessage, TOptimistic>
  readonly #input = new RuntimeDomInputController()
  readonly #scrollState = new ScrollInteractionState()
  readonly #edgeNeedLatch = new EdgeNeedLatch()
  readonly #motion = new ScrollMotionEngine()
  readonly #observers = new RuntimeDomObserverController({
    onContainerResize: () => this.#scheduleResizeRelayout('resize'),
    onRowResize: () => this.#scheduleResizeRelayout('measurement'),
  })
  #pendingResizeRelayoutReason: 'resize' | 'measurement' | null = null
  #segmentShiftSettleFrame: number | null = null

  constructor(
    deps: RuntimeControllerInputCoordinatorDeps<TMessage, TOptimistic>,
  ) {
    this.#deps = deps
  }

  attach(container: HTMLElement): void {
    this.#input.attach(container, {
      onScrollFrame: (scrollTop) => this.#handleScrollFrame(scrollTop),
      onWheelBoundary: (event) => this.#handleWheelBoundary(event),
    })
    this.#observers.attach(container)
  }

  detach(): void {
    this.#motion.cancel('detach', this.motionContext())
    this.#cancelSegmentShiftSettleFrame()
    this.#input.detach()
    this.#observers.detach()
    this.#edgeNeedLatch.clear()
  }

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    this.#observers.registerRow(key, element)
  }

  directScrollContext() {
    return {
      writer: this.#deps.writer,
      metrics: this.#deps.metrics,
      dom: this.#deps.dom,
      diagnostics: this.#deps.diagnostics,
      scrollState: this.#scrollState,
      setCurrentScrollTop: this.#deps.setCurrentScrollTop,
      reconcileBottomLock: () =>
        reconcileBottomLockFromMetrics(this.#deps, this.#scrollState),
      canBuildSegmentShift: (direction: SegmentShiftDirection) =>
        this.#canBuildSegmentShift(direction),
      enqueueSegmentShift: (
        direction: SegmentShiftDirection,
        source: 'drag-handoff' | 'wheel',
      ) => this.#enqueueSegmentShift(direction, source),
      deferSegmentShiftNeed: (
        direction: SegmentShiftDirection,
        origin: PendingSegmentShiftOrigin,
      ) => this.#deferSegmentShiftNeed(direction, origin),
    }
  }

  motion(): ScrollMotionEngine {
    return this.#motion
  }

  motionContext() {
    return {
      writer: this.#deps.writer,
      dom: this.#deps.dom,
      diagnostics: this.#deps.diagnostics,
      setCurrentScrollTop: this.#deps.setCurrentScrollTop,
    }
  }

  syncAdjacentPrefetchState(): void {
    syncAdjacentPrefetchState(this.#deps)
  }

  handleTransactionAbort(transaction: RuntimeTransaction<TMessage, TOptimistic>): void {
    if (transaction.kind !== 'segmentShift') return
    this.#scheduleSegmentShiftSettle(transaction, 'abort')
  }

  cancelAll(): void {
    this.#cancelSegmentShiftSettleFrame()
    this.#scrollState.abortSegmentShift()
    this.#scrollState.endDrag()
    this.#deps.metrics.patchFlags(this.#scrollState.toFlags())
    reconcileBottomLockFromMetrics(this.#deps, this.#scrollState)
  }

  resolveScrollFlagsForPromotion(
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
    segment: PhysicalSegment,
  ): Partial<PhysicalScrollMetrics> {
    if (transaction.kind === 'segmentShift') {
      this.#scheduleSegmentShiftSettle(transaction, 'commit')
    }

    const currentMetrics = this.#deps.metrics.getMetrics()
    const snapshot = this.#deps.data.requireSnapshot()

    return {
      ...this.#scrollState.toFlags(),
      ...resolveAdjacentPrefetchFlags({
        snapshot,
        segment,
        previousMetrics: currentMetrics,
      }),
    }
  }

  #handleScrollFrame(scrollTop: number): void {
    if (this.#deps.getDestroyed()) return
    const boundedScrollTop = this.#clampNativeScrollTop(scrollTop)
    this.#deps.setCurrentScrollTop(boundedScrollTop)
    this.#deps.metrics.patchScrollPosition(this.#deps.getCurrentScrollTop())
    reconcileBottomLockFromScroll(this.#deps, this.#scrollState)
    emitAdjacentPrefetchNeed(this.#deps, this.#edgeNeedLatch)
  }

  #clampNativeScrollTop(scrollTop: number): number {
    const metrics = this.#deps.metrics.getMetrics()
    const nextScrollTop = Math.max(0, scrollTop)
    if (
      metrics.physicalSegmentId === null ||
      metrics.isDragLocked ||
      metrics.isThumbFrozen
    ) {
      return nextScrollTop
    }

    const rangeStart = Math.min(
      metrics.maxScrollPosition,
      Math.max(0, metrics.safeScrollRangeStart),
    )
    const rangeEnd = Math.min(
      metrics.maxScrollPosition,
      Math.max(rangeStart, metrics.safeScrollRangeEnd),
    )
    const boundedScrollTop = Math.min(
      rangeEnd,
      Math.max(rangeStart, nextScrollTop),
    )
    if (boundedScrollTop === nextScrollTop) return boundedScrollTop

    const token = {
      transactionId: 'native-scroll-clamp',
      kind: 'anchor-correction' as const,
    }
    const acquired = this.#deps.writer.acquire(token)
    if (!acquired.acquired) {
      this.#deps.diagnostics.record({
        kind: 'writer-arbitration',
        severity: 'warn',
        owner: 'scroll',
        message: 'native scroll clamp writer denied',
      })
      return nextScrollTop
    }
    this.#deps.writer.writeScrollTop(
      this.#deps.dom.getContainer(),
      boundedScrollTop,
      token,
    )
    this.#deps.writer.release(token)

    return boundedScrollTop
  }

  #handleWheelBoundary(event: WheelEvent): boolean {
    return handleWheelBoundaryEvent(event, {
      getDestroyed: this.#deps.getDestroyed,
      metrics: this.#deps.metrics,
      scrollState: this.#scrollState,
      diagnostics: this.#deps.diagnostics,
      canBuildSegmentShift: (direction) =>
        this.#canBuildSegmentShift(direction),
      enqueueSegmentShift: (direction) =>
        this.#enqueueSegmentShift(direction, 'wheel'),
      deferSegmentShiftNeed: (direction) =>
        this.#deferSegmentShiftNeed(direction, 'wheel'),
    })
  }

  #scheduleResizeRelayout(reason: 'resize' | 'measurement'): void {
    if (this.#deps.getDestroyed() || this.#deps.revision.getCommittedSegment() === null) {
      return
    }
    if (this.#pendingResizeRelayoutReason !== null) return
    this.#pendingResizeRelayoutReason = reason
    queueMicrotask(() => this.#flushResizeRelayout())
  }

  #flushResizeRelayout(): void {
    const pending = this.#pendingResizeRelayoutReason
    this.#pendingResizeRelayoutReason = null
    if (
      pending === null ||
      this.#deps.getDestroyed() ||
      this.#deps.dom.getContainer() === null ||
      this.#deps.revision.getCommittedSegment() === null
    ) {
      return
    }
    this.#deps.enqueue({ kind: 'segmentRelayout', reason: pending })
  }

  #canBuildSegmentShift(direction: SegmentShiftDirection): boolean {
    const snapshot = this.#deps.data.getSnapshot()
    return snapshot !== null &&
      hasAdjacentSegmentData(
        snapshot,
        this.#deps.revision.getCommittedSegment(),
        direction,
      )
  }

  #enqueueSegmentShift(
    direction: SegmentShiftDirection,
    source: 'drag-handoff' | 'wheel',
  ): void {
    this.#scrollState.beginSegmentShift({ direction })
    this.#deps.metrics.patchFlags(this.#scrollState.toFlags())
    reconcileBottomLockFromMetrics(this.#deps, this.#scrollState)
    this.#deps.enqueue({ kind: 'segmentShift', direction, source })
  }

  #deferSegmentShiftNeed(
    direction: SegmentShiftDirection,
    origin: PendingSegmentShiftOrigin,
  ): void {
    const intent: PendingDataIntent = {
      kind: 'segmentShift',
      direction,
      origin,
      priority: 'edge',
    }
    this.#deps.setPendingDataIntent(intent)
    this.#scrollState.markEdgePending({ direction, overflowPx: 0 })
    this.#deps.metrics.patchFlags(this.#scrollState.toFlags())
    reconcileBottomLockFromMetrics(this.#deps, this.#scrollState)
    this.#deps.emitNeedForPendingIntent(intent)
  }

  #scheduleSegmentShiftSettle(
    transaction: RuntimeTransaction<TMessage, TOptimistic>,
    result: 'commit' | 'abort',
  ): void {
    this.#cancelSegmentShiftSettleFrame()
    const source = transaction.intent.kind === 'segmentShift'
      ? transaction.intent.source
      : undefined
    if (source === 'drag-handoff') {
      this.#restoreDragWriterOwnership()
    }
    this.#segmentShiftSettleFrame = getRuntimeAnimationFrame().request(() => {
      this.#segmentShiftSettleFrame = null
      this.#scrollState.completeSegmentShift()
      this.#deps.metrics.patchFlags(this.#scrollState.toFlags())
      reconcileBottomLockFromMetrics(this.#deps, this.#scrollState)
      this.#recordSegmentShiftSettle(source, result)
    })
  }

  #recordSegmentShiftSettle(
    source: 'edge' | 'drag-handoff' | 'wheel' | 'keyboard' | 'data' | undefined,
    result: 'commit' | 'abort',
  ): void {
    if (source === 'drag-handoff' && this.#scrollState.isDragLocked()) {
      this.#deps.diagnostics.record({
        kind: 'transaction-lifecycle',
        severity: 'info',
        owner: 'scroll',
        message: result === 'commit'
          ? 'scroll.dragSegmentHandoff.complete'
          : 'scroll.dragSegmentHandoff.abort',
      })
    }
    if (source === 'wheel') {
      this.#deps.diagnostics.record({
        kind: 'transaction-lifecycle',
        severity: 'info',
        owner: 'scroll',
        message: 'scroll.momentum.release',
      })
    }
  }

  #cancelSegmentShiftSettleFrame(): void {
    if (this.#segmentShiftSettleFrame === null) return
    getRuntimeAnimationFrame().cancel(this.#segmentShiftSettleFrame)
    this.#segmentShiftSettleFrame = null
  }

  #restoreDragWriterOwnership(): void {
    if (!this.#scrollState.isDragLocked()) return
    const result = this.#deps.writer.acquire({
      transactionId: 'direct-scroll',
      kind: 'direct-drag',
    })
    if (result.acquired) return
    const active = 'active' in result ? result.active : null

    this.#scrollState.endDrag()
    this.#deps.metrics.patchFlags(this.#scrollState.toFlags())
    reconcileBottomLockFromMetrics(this.#deps, this.#scrollState)
    this.#deps.diagnostics.record({
      kind: 'drag-lock-stolen',
      severity: 'warn',
      owner: 'scroll',
      message: 'scroll.dragSegmentHandoff.writerDenied',
      details: { active },
    })
  }
}
