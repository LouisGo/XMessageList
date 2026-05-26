import { correctTransactionAnchor } from './anchorCorrection'
import { DiagnosticRingBuffer } from './diagnostics'
import { RuntimeDomRegistry } from './domRegistry'
import { createViewportEvidence } from './evidence'
import type { MessageIdentityAnchor, MessageRuntimeItemKey } from './identity'
import type { MessageListAdapterRuntime } from './internal'
import {
  createBrowserObserverFactory,
  createInitialSnapshot,
  createSnapshotFromSegment,
  isSameToken,
  isSameSegmentToken,
  resolveAnchorFromSnapshot,
  withNextProjectionRevision,
} from './controllerHelpers'
import { RuntimeDomInteractions } from './domInteractions'
import {
  RuntimeInteractionState,
  type DestinationIntent,
  type InteractionUpdate,
  type RuntimeEdge,
} from './interactionState'
import type {
  MessageListRuntimeEvent,
  MessageListRuntimeEventListener,
  ViewportAnchorChangedEvent,
  ViewportObservationListener,
} from './events'
import type { LoadedSegment } from './segment'
import { createDefaultScheduler } from './scheduler'
import { captureVisualAnchor, measureRuntimeDom, type VisualAnchor } from './measurement'
import type {
  MessageListRuntimeOptions,
  RuntimeObserverFactory,
  RuntimeScheduler,
} from './options'
import type {
  MessageListSnapshot,
  MessageListSnapshotListener,
  ProjectionCommitToken,
  ViewportEvidence,
} from './snapshot'
import {
  isStaleLoadedSegment,
  removeQueuedSegmentsBeforeGeneration,
} from './transactionQueue'
import { settleTransactionScrollPosition } from './transactionSettlement'

type PendingTransaction<TMessage, TOptimistic> = {
  token: ProjectionCommitToken
  segment: LoadedSegment<TMessage, TOptimistic>
  anchor: VisualAnchor | null
  timeoutHandle: number
  startedAt: number
}

export class MessageListRuntimeController<TMessage = unknown, TOptimistic = unknown>
  implements MessageListAdapterRuntime<TMessage, TOptimistic> {
  private readonly scheduler: RuntimeScheduler
  private readonly observerFactory: RuntimeObserverFactory | null
  private readonly registry = new RuntimeDomRegistry()
  private readonly diagnostics: DiagnosticRingBuffer
  private readonly interactions = new RuntimeInteractionState<TMessage, TOptimistic>()
  private readonly domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  private readonly snapshotListeners = new Set<MessageListSnapshotListener>()
  private readonly eventListeners = new Set<MessageListRuntimeEventListener>()
  private snapshot: MessageListSnapshot<TMessage, TOptimistic>
  private pendingTransaction: PendingTransaction<TMessage, TOptimistic> | null = null
  private readonly transactionQueue: Array<LoadedSegment<TMessage, TOptimistic>> = []
  private isAdvancingTransactionQueue = false
  private lastMeasurement = measureRuntimeDom(this.registry.snapshot())
  private lastAnchor: MessageIdentityAnchor | null = null
  private readonly resizeObserver: ResizeObserver | null = null
  private resizeFrame: number | null = null

  constructor(private readonly options: MessageListRuntimeOptions) {
    this.scheduler = options.scheduler ?? createDefaultScheduler()
    this.observerFactory = options.observers ?? createBrowserObserverFactory()
    this.diagnostics = new DiagnosticRingBuffer(this.scheduler)
    this.domInteractions = new RuntimeDomInteractions({
      scheduler: this.scheduler,
      observerFactory: this.observerFactory,
      registry: this.registry,
      onEdgeIntersect: (edge) => this.handleEdgeIntersection(edge),
      onScrollFrame: () => this.handleScrollFrame(),
      onDiagnostic: (name, severity, details) => this.pushDiagnostic(name, severity, details),
    })
    this.snapshot = createInitialSnapshot<TMessage, TOptimistic>(options.feedId ?? 'default')
    this.resizeObserver = this.observerFactory?.createResizeObserver(() => {
      this.scheduleResizeMeasurement()
    }) ?? null
  }

  attachScrollContainer(container: HTMLElement): void {
    this.domInteractions.attachScrollContainer(container)
  }

  detachScrollContainer(): void {
    this.emitAnchorChanged('detach', this.resolveCurrentVisualAnchor())
    this.domInteractions.detachScrollContainer()
    for (const row of this.registry.clearAll()) {
      this.resizeObserver?.unobserve(row)
    }
  }

  destroy(): void {
    if (this.pendingTransaction) {
      this.scheduler.clearTimeout(this.pendingTransaction.timeoutHandle)
    }
    if (this.resizeFrame !== null) {
      this.scheduler.cancelAnimationFrame(this.resizeFrame)
    }
    this.resizeObserver?.disconnect()
    this.domInteractions.detachScrollContainer()
    this.registry.clearAll()
    this.pendingTransaction = null
    this.transactionQueue.length = 0
    this.resizeFrame = null
    this.snapshotListeners.clear()
    this.eventListeners.clear()
  }

  applyLoadedSegment(segment: LoadedSegment<TMessage, TOptimistic>): void {
    if (this.isStaleSegment(segment)) {
      this.pushDiagnostic('transaction.staleSegment', 'warn', {
        segmentGeneration: segment.generation,
        currentGeneration: this.snapshot.generation,
        segmentRevision: segment.segmentRevision,
        currentSegmentRevision: this.snapshot.segmentRevision,
      })
      return
    }

    this.cancelTransactionsBeforeGeneration(segment)

    if (this.pendingTransaction || this.isAdvancingTransactionQueue) {
      this.transactionQueue.push(segment)
      this.pushDiagnostic('transaction.queued', 'info', {
        feedId: segment.feedId,
        generation: segment.generation,
        segmentRevision: segment.segmentRevision,
        queueLength: this.transactionQueue.length,
      })
      return
    }

    this.startTransaction(segment)
  }

  private startTransaction(segment: LoadedSegment<TMessage, TOptimistic>): void {
    const projectionRevision = this.snapshot.projectionRevision + 1
    const token = {
      feedId: segment.feedId,
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      projectionRevision,
    }
    const anchor = captureVisualAnchor(this.registry.snapshot())
    const timeoutHandle = this.scheduler.setTimeout(() => {
      if (
        !this.pendingTransaction ||
        !isSameToken(this.pendingTransaction.token, token)
      ) {
        return
      }

      this.isAdvancingTransactionQueue = true
      try {
        this.pendingTransaction = null
        this.setViewportPhase('IDLE')
        this.pushDiagnostic('transaction.commitTimeout', 'error', token)
        this.emitRuntimeEvent({
          type: 'viewportError',
          feedId: token.feedId,
          code: 'commit-timeout',
          message: 'Projection commit timed out.',
        })
      } finally {
        this.isAdvancingTransactionQueue = false
      }
      this.startNextQueuedTransaction()
    }, this.options.commitTimeoutMs ?? 120)

    this.pendingTransaction = { token, segment, anchor, timeoutHandle, startedAt: this.scheduler.now() }
    this.snapshot = createSnapshotFromSegment(segment, {
      previous: this.snapshot,
      projectionRevision,
      viewportPhase: 'PROJECTING',
    })
    this.emitSnapshot()
  }

  ackProjectionCommit(token: ProjectionCommitToken): void {
    const pending = this.pendingTransaction

    if (!pending || !isSameToken(pending.token, token)) {
      if (!pending && isSameSegmentToken(this.snapshot.commitToken, token)) {
        return
      }

      this.pushDiagnostic('transaction.staleCommitAck', 'warn', token)
      return
    }

    this.scheduler.clearTimeout(pending.timeoutHandle)
    this.isAdvancingTransactionQueue = true
    try {
      this.setViewportPhase('MEASURING')
      this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
      this.setViewportPhase('CORRECTING')
      const settledAnchor = settleTransactionScrollPosition({
        snapshot: this.snapshot,
        segment: pending.segment,
        capturedAnchor: pending.anchor,
        destination: this.interactions.getPendingDestination(),
        domInteractions: this.domInteractions,
        correctAnchor: (anchor, segment) => this.correctAnchor(anchor, segment),
        getViewportAnchor: () => this.getViewportAnchor(),
      })
      this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
      this.domInteractions.recordRowMetrics()
      this.snapshot = this.interactions.settleSegment(
        this.snapshot,
        pending.segment,
      )
      this.pendingTransaction = null
      this.setViewportPhase('IDLE')
      this.pushDiagnostic('transaction.settle', 'info', { ...token, latencyMs: this.scheduler.now() - pending.startedAt })
      this.emitViewportObservation()
      this.emitAnchorChanged('transaction-settle', settledAnchor)
    } finally {
      this.isAdvancingTransactionQueue = false
    }
    this.startNextQueuedTransaction()
    this.evaluateUnderflow()
  }

  scrollToLatest(): void {
    const update = this.interactions.startFollowBottom(this.snapshot)
    this.applyInteractionUpdate(update)

    if (!update.event) {
      this.domInteractions.scrollToNativeBottom()
    }
  }

  scrollToMessage(
    target: MessageIdentityAnchor,
    options: import('./options').MessageListScrollToMessageOptions = {},
  ): void {
    if (this.alignLocalDestination(target, options.align ?? 'nearest')) {
      return
    }

    this.startDestination({
      target,
      reason: 'jump',
      align: options.align ?? 'nearest',
    })
  }

  restoreToMessage(
    target: MessageIdentityAnchor,
    options: import('./options').MessageListRestoreOptions = {},
  ): void {
    if (this.alignLocalDestination(target, options.align ?? 'center')) {
      return
    }

    this.startDestination({
      target,
      reason: 'restore',
      align: options.align ?? 'center',
    })
  }

  private alignLocalDestination(
    target: MessageIdentityAnchor,
    align: DestinationIntent['align'],
  ): boolean {
    if (!this.domInteractions.alignToMessage(this.snapshot, target, align)) {
      return false
    }

    this.snapshot = {
      ...this.snapshot,
      bottomLockState: 'UNLOCKED',
      pendingIntent: null,
    }
    this.emitSnapshot()
    this.emitAnchorChanged('transaction-settle', target)
    return true
  }

  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic> {
    return this.snapshot
  }

  subscribeSnapshot(listener: MessageListSnapshotListener): () => void {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  subscribeRuntimeEvent(listener: MessageListRuntimeEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeViewportObservation(listener: ViewportObservationListener): () => void {
    return this.subscribeRuntimeEvent((event) => {
      if (event.type === 'viewportObservationChanged') {
        listener(event)
      }
    })
  }

  getViewportAnchor(): MessageIdentityAnchor | null {
    return this.lastAnchor ?? this.snapshot.segmentMeta.anchor ?? null
  }

  getDiagnostics(): import('./events').ViewportDiagnosticRecord[] {
    return this.diagnostics.getRecords()
  }

  getEvidence(): ViewportEvidence {
    return createViewportEvidence(
      this.snapshot,
      this.lastMeasurement,
      this.pendingTransaction?.token ?? null,
    )
  }

  registerMessageFlowElement(element: HTMLElement | null): void {
    this.registry.setMessageFlow(element)
  }

  registerBeforeTriggerElement(element: HTMLElement | null): void {
    this.registry.setBeforeTrigger(element)
    this.domInteractions.registerEdgeTrigger('before', element)
  }

  registerAfterTriggerElement(element: HTMLElement | null): void {
    this.registry.setAfterTrigger(element)
    this.domInteractions.registerEdgeTrigger('after', element)
  }

  registerBottomMarkerElement(element: HTMLElement | null): void {
    this.registry.setBottomMarker(element)
  }

  registerRowElement(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    const previous = this.registry.getRow(key)

    if (previous && previous !== element) {
      this.resizeObserver?.unobserve(previous)
    }

    this.registry.setRow(key, element)

    if (element) {
      this.resizeObserver?.observe(element)
    }
  }

  beginDirectScroll(): void {
    this.domInteractions.beginDirectScroll()
  }

  writeDirectScrollTop(scrollTop: number): boolean {
    return this.domInteractions.writeDirectScrollTop(scrollTop)
  }

  endDirectScroll(): void {
    this.domInteractions.endDirectScroll()
  }

  reportEdgeRequestFailure(edge: RuntimeEdge, requestToken: string): void {
    this.snapshot = this.interactions.reportEdgeError(this.snapshot, edge, requestToken)
    this.emitSnapshot()
  }

  retryEdgeRequest(edge: RuntimeEdge): void {
    const update = this.interactions.retryEdge(this.snapshot, edge)
    if (update) {
      this.applyInteractionUpdate(update)
    }
  }

  reportOverlayMetricMismatch(details: Record<string, unknown>): void { this.pushDiagnostic('overlay.metricMismatch', 'warn', details) }

  private correctAnchor(
    anchor: VisualAnchor | null,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageIdentityAnchor | null {
    return correctTransactionAnchor({
      anchor,
      segment,
      snapshot: this.snapshot,
      registry: this.registry,
      domInteractions: this.domInteractions,
      pushDiagnostic: (name, severity, details) =>
        this.pushDiagnostic(name, severity, details),
      emitRuntimeEvent: (event) => this.emitRuntimeEvent(event),
    })
  }

  private resolveCurrentVisualAnchor(): MessageIdentityAnchor | null {
    const anchor = captureVisualAnchor(this.registry.snapshot())

    if (!anchor) {
      return this.getViewportAnchor()
    }
    return resolveAnchorFromSnapshot(this.snapshot, anchor.key) ??
      this.getViewportAnchor()
  }

  private startDestination(intent: DestinationIntent): void {
    this.applyInteractionUpdate(
      this.interactions.startDestination(this.snapshot, intent),
    )
  }

  private applyInteractionUpdate(
    update: InteractionUpdate<TMessage, TOptimistic>,
  ): void {
    this.snapshot = withNextProjectionRevision(update.snapshot)
    this.emitSnapshot()

    if (update.event) {
      this.emitRuntimeEvent(update.event)
    }
  }

  private handleEdgeIntersection(edge: RuntimeEdge): void {
    const update = this.interactions.startEdgeNeed(
      this.snapshot,
      edge,
      edge === 'before' ? 'near-before' : 'near-after',
      edge === 'before' ? 'edge-before' : 'edge-after',
    )

    if (update) {
      this.applyInteractionUpdate(update)
    }
  }

  private scheduleResizeMeasurement(): void {
    if (this.resizeFrame !== null) {
      return
    }
    this.resizeFrame = this.scheduler.requestAnimationFrame(() => {
      this.resizeFrame = null
      this.domInteractions.preserveVisualAnchor(captureVisualAnchor(this.registry.snapshot()))
      this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
      this.domInteractions.recordRowMetrics()
      this.pushDiagnostic('measurement.resizeDirty', 'info', {
        rowCount: this.lastMeasurement.visibleRows.length,
      })
      this.emitViewportObservation()
      this.evaluateUnderflow()
    })
  }

  private handleScrollFrame(): void {
    if (this.pendingTransaction || this.snapshot.viewportPhase !== 'IDLE') {
      return
    }

    this.lastMeasurement = measureRuntimeDom(this.registry.snapshot(), {
      rowKeys: this.domInteractions.getScrollSampleKeys(),
    })
    this.emitViewportObservation()
    this.emitAnchorChanged(
      'scroll-idle',
      this.resolveMeasuredViewportAnchor(),
    )
  }

  private resolveMeasuredViewportAnchor(): MessageIdentityAnchor | null {
    const key = this.lastMeasurement.visibleRows[0]?.key
    return key
      ? resolveAnchorFromSnapshot(this.snapshot, key) ?? this.getViewportAnchor()
      : this.getViewportAnchor()
  }

  private setViewportPhase(phase: MessageListSnapshot['viewportPhase']): void {
    this.snapshot = {
      ...this.snapshot,
      viewportPhase: phase,
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    for (const listener of this.snapshotListeners) {
      listener()
    }
  }

  private startNextQueuedTransaction(): void {
    if (this.pendingTransaction || this.isAdvancingTransactionQueue) {
      return
    }
    const next = this.transactionQueue.shift()
    if (next) {
      this.startTransaction(next)
    }
  }

  private cancelTransactionsBeforeGeneration(
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): void {
    const generation = segment.generation
    if (
      this.pendingTransaction &&
      this.pendingTransaction.segment.generation < generation
    ) {
      this.scheduler.clearTimeout(this.pendingTransaction.timeoutHandle)
      this.pendingTransaction = null
    }
    removeQueuedSegmentsBeforeGeneration(this.transactionQueue, generation)
    if (
      generation > this.snapshot.generation &&
      !this.shouldPreservePendingIntentFor(segment)
    ) {
      this.snapshot = this.interactions.resetForGeneration(this.snapshot)
    }
  }

  private shouldPreservePendingIntentFor(
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): boolean {
    return (
      this.snapshot.pendingIntent === 'follow-bottom' &&
      segment.modifier.type === 'reset-latest'
    ) || (
      this.snapshot.pendingIntent === 'destination' &&
      segment.modifier.type === 'reset-around'
    )
  }

  private isStaleSegment(
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): boolean {
    return isStaleLoadedSegment(
      segment,
      this.transactionQueue.at(-1) ?? this.pendingTransaction?.segment,
      this.snapshot,
    )
  }

  private pushDiagnostic(
    name: string,
    severity: import('./events').ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ): void {
    const record = this.diagnostics.push(name, severity, details)
    this.emitRuntimeEvent({ type: 'viewportDiagnostic', record })
  }

  private emitRuntimeEvent(event: MessageListRuntimeEvent): void {
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }

  private emitAnchorChanged(
    reason: ViewportAnchorChangedEvent['reason'],
    anchor: MessageIdentityAnchor | null,
  ): void {
    this.lastAnchor = anchor
    this.emitRuntimeEvent({
      type: 'viewportAnchorChanged',
      feedId: this.snapshot.feedId,
      reason,
      anchor,
    })
  }

  private emitViewportObservation(): void {
    this.emitRuntimeEvent({
      type: 'viewportObservationChanged',
      feedId: this.snapshot.feedId,
      visibleKeys: this.lastMeasurement.visibleRows.map((row) => row.key),
    })
  }

  private evaluateUnderflow(): void {
    const update = this.interactions.evaluateUnderflow({
      snapshot: this.snapshot,
      scrollHeight: this.lastMeasurement.scrollHeight,
      clientHeight: this.lastMeasurement.clientHeight,
    })

    if (update) {
      this.applyInteractionUpdate(update)
    }
  }
}
