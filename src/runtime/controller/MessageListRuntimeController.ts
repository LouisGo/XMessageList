import { correctTransactionAnchor } from '../dom/anchorCorrection'
import { DiagnosticRingBuffer } from '../events/diagnostics'
import { RuntimeDomRegistry } from '../dom/domRegistry'
import { createViewportEvidence } from '../events/evidence'
import type { MessageIdentityAnchor, MessageRuntimeItemKey } from '../contracts/identity'
import type { MessageListAdapterRuntime } from '../internal'
import { createBrowserObserverFactory, createInitialSnapshot, createSnapshotFromSegment, isSameSegmentToken, isSameToken } from './controllerHelpers'
import { resolvePendingAnchorKey, resolveTransactionScrollSource, resolveTransactionStateForPhase, shouldWaitForAnchorRef, type PendingTransaction } from './controllerTransactionHelpers'
import { withNextProjectionRevision } from '../shared/snapshotIdentity'
import { RuntimeDomInteractions } from '../dom/domInteractions'
import { RuntimeScrollIntentCoordinator } from '../scroll/runtimeScrollIntent'
import { RuntimeInteractionState, type DestinationIntent, type InteractionUpdate, type RuntimeEdge } from '../interactions/interactionState'
import type { MessageListRuntimeEvent, MessageListRuntimeEventListener, ViewportAnchorChangedEvent, ViewportObservationListener, ViewportObservationReason } from '../contracts/events'
import type { LoadedSegment } from '../contracts/segment'
import { RuntimeStateAxes } from '../state/runtimeStateAxes'
import { createDefaultScheduler } from './scheduler'
import { captureVisualAnchor, measureRuntimeDom, type VisualAnchor } from '../dom/measurement'
import type { MessageListRuntimeOptions, RuntimeObserverFactory, RuntimeScheduler } from '../contracts/options'
import type { MessageListSnapshot, MessageListSnapshotListener, ProjectionCommitToken, ViewportEvidence } from '../contracts/snapshot'
import { createPostCommitInteractionUpdates } from '../interactions/postCommitInteractions'
import { createDestinationSettledEvent, createSegmentTrimPressureEvent, createViewportObservationEvent } from '../events/runtimePublicEvents'
import { isStaleLoadedSegment, removeQueuedSegmentsBeforeGeneration } from './transactionQueue'
import { settleTransactionScrollPosition } from '../transactions/transactionSettlement'
import { resolveCurrentViewportAnchor, resolveMeasuredViewportAnchor, resolveViewportAnchorEventInput, type ResolvedViewportAnchor, type ViewportAnchorEventInput } from '../dom/viewportAnchorEvents'
export class MessageListRuntimeController<TMessage = unknown, TOptimistic = unknown>
  implements MessageListAdapterRuntime<TMessage, TOptimistic> {
  private readonly scheduler: RuntimeScheduler
  private readonly observerFactory: RuntimeObserverFactory | null
  private readonly registry = new RuntimeDomRegistry()
  private readonly diagnostics: DiagnosticRingBuffer
  private readonly interactions: RuntimeInteractionState<TMessage, TOptimistic>
  private readonly stateAxes = new RuntimeStateAxes()
  private readonly scrollIntent: RuntimeScrollIntentCoordinator
  private readonly domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  private readonly snapshotListeners = new Set<MessageListSnapshotListener>()
  private readonly eventListeners = new Set<MessageListRuntimeEventListener>()
  private snapshot: MessageListSnapshot<TMessage, TOptimistic>
  private pendingTransaction: PendingTransaction<TMessage, TOptimistic> | null = null
  private readonly transactionQueue: Array<LoadedSegment<TMessage, TOptimistic>> = []
  private isAdvancingTransactionQueue = false
  private lastMeasurement = measureRuntimeDom(this.registry.snapshot())
  private lastObservationScrollTop = 0
  private lastAnchor: MessageIdentityAnchor | null = null
  private lastAnchorOffsetWithinMessage: number | undefined
  private readyGenerationKey: string | null = null
  private readonly resizeObserver: ResizeObserver | null = null
  private resizeFrame: number | null = null
  constructor(private readonly options: MessageListRuntimeOptions) {
    this.scheduler = options.scheduler ?? createDefaultScheduler()
    this.observerFactory = options.observers ?? createBrowserObserverFactory()
    this.diagnostics = new DiagnosticRingBuffer(this.scheduler)
    this.interactions = new RuntimeInteractionState(
      this.stateAxes,
      options.underflowTolerancePx,
      options.edgeActivationMarginPx,
    )
    this.scrollIntent = new RuntimeScrollIntentCoordinator(options)
    this.domInteractions = new RuntimeDomInteractions({
      scheduler: this.scheduler,
      observerFactory: this.observerFactory,
      registry: this.registry,
      onEdgeIntersect: (edge) => this.handleEdgeIntersection(edge),
      onScrollWrite: (source) => this.scrollIntent.markScrollWrite(source),
      onUserScrollIntent: () => this.scrollIntent.markUserScrollIntent(),
      onScrollFrame: () => this.handleScrollFrame(),
      edgeActivationMarginPx: options.edgeActivationMarginPx,
      onDiagnostic: (name, severity, details) => this.pushDiagnostic(name, severity, details),
    })
    this.snapshot = createInitialSnapshot<TMessage, TOptimistic>(options.feedId ?? 'default')
    this.resizeObserver = this.observerFactory?.createResizeObserver(() => this.scheduleResizeMeasurement()) ?? null
  }
  attachScrollContainer(container: HTMLElement): void { this.domInteractions.attachScrollContainer(container) }
  detachScrollContainer(): void {
    const anchor = this.resolveCurrentVisualAnchor()
    this.emitAnchorChanged('detach', anchor)
    this.emitViewportObservation('detach', null, anchor)
    this.domInteractions.detachScrollContainer()
    for (const row of this.registry.clearAll()) {
      this.resizeObserver?.unobserve(row)
    }
  }
  destroy(): void {
    if (this.pendingTransaction) this.scheduler.clearTimeout(this.pendingTransaction.timeoutHandle)
    if (this.resizeFrame !== null) this.scheduler.cancelAnimationFrame(this.resizeFrame)
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
      this.stateAxes.setTransactionState('queued')
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
      if (!this.pendingTransaction || !isSameToken(this.pendingTransaction.token, token)) {
        return
      }
      this.isAdvancingTransactionQueue = true
      try {
        this.pendingTransaction = null
        this.stateAxes.setTransactionState('idle')
        this.setViewportPhase('IDLE')
        this.pushDiagnostic('transaction.commitTimeout', 'error', token)
        this.emitRuntimeEvent({ type: 'viewportError', feedId: token.feedId, code: 'commit-timeout', message: 'Projection commit timed out.' })
      } finally {
        this.isAdvancingTransactionQueue = false
      }
      this.startNextQueuedTransaction()
    }, this.options.commitTimeoutMs ?? 120)
    this.pendingTransaction = {
      token,
      segment,
      anchor,
      timeoutHandle,
      startedAt: this.scheduler.now(),
      anchorRetryCount: 0,
    }
    this.stateAxes.setTransactionState('active')
    this.snapshot = createSnapshotFromSegment(segment, { previous: this.snapshot, projectionRevision, viewportPhase: 'PROJECTING' })
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
    this.continueCommittedTransaction(token)
  }
  private continueCommittedTransaction(token: ProjectionCommitToken): void {
    const pending = this.pendingTransaction
    if (!pending || !isSameToken(pending.token, token)) {
      return
    }
    this.isAdvancingTransactionQueue = true
    let settled = false
    try {
      this.scrollIntent.incrementFrame()
      this.stateAxes.setTransactionState('measuring')
      this.setViewportPhase('MEASURING')
      this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
      if (shouldWaitForAnchorRef(pending, this.registry)) {
        pending.anchorRetryCount += 1
        this.pushDiagnostic('correction.anchorAwaitingRef', 'debug', {
          ...token,
          key: resolvePendingAnchorKey(pending),
        })
        this.scheduler.requestAnimationFrame(() => {
          this.continueCommittedTransaction(token)
        })
        return
      }
      this.stateAxes.setTransactionState('correcting')
      this.setViewportPhase('CORRECTING')
      const destination = this.interactions.getPendingDestination()
      const transactionScrollSource = resolveTransactionScrollSource({
        snapshot: this.snapshot,
        segment: pending.segment,
        destination,
      })
      if (pending.segment.modifier.type === 'reset-around') {
        this.interactions.markPendingDestinationResolvingDom()
      }
      const settledAnchor = settleTransactionScrollPosition({
        snapshot: this.snapshot,
        segment: pending.segment,
        capturedAnchor: pending.anchor,
        destination,
        activeFollowBottom: this.interactions.hasActiveFollowBottom(this.snapshot),
        domInteractions: this.domInteractions,
        correctAnchor: (anchor, segment) => this.correctAnchor(anchor, segment),
        getViewportAnchor: () => this.getViewportAnchor(),
      })
      this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
      this.domInteractions.recordRowMetrics()
      this.stateAxes.setTransactionState('settling')
      this.snapshot = this.interactions.settleSegment(
        this.snapshot,
        pending.segment,
      )
      this.domInteractions.settleDirectScrollSegment(pending.segment.modifier)
      this.syncScrollIntentBottomLock()
      this.pendingTransaction = null
      this.stateAxes.setTransactionState('idle')
      this.setViewportPhase('IDLE')
      this.pushDiagnostic('transaction.settle', 'info', { ...token, latencyMs: this.scheduler.now() - pending.startedAt })
      this.emitViewportReadyOnce(token)
      this.emitViewportObservation('transaction-settle', transactionScrollSource, settledAnchor)
      this.emitAnchorChanged('transaction-settle', settledAnchor)
      if (destination && pending.segment.modifier.type === 'reset-around') {
        this.emitDestinationSettled(destination, settledAnchor)
      }
      this.emitSegmentTrimPressure(pending.segment, settledAnchor)
      settled = true
    } finally {
      this.isAdvancingTransactionQueue = false
    }
    if (settled) {
      this.startNextQueuedTransaction()
      this.applyPostCommitInteractionUpdates(this.domInteractions.getDirectScrollEdgeIntent())
    }
  }
  scrollToLatest(): void {
    const update = this.interactions.startFollowBottom(
      this.snapshot,
      this.readCurrentScrollTop(),
    )
    this.applyInteractionUpdate(update)
    if (!update.event) {
      this.domInteractions.scrollToNativeBottom()
    }
  }
  scrollToMessage(
    target: MessageIdentityAnchor,
    options: import('../contracts/options').MessageListScrollToMessageOptions = {},
  ): void {
    const align = options.align ?? 'center'
    if (this.alignLocalDestination(target, align, undefined, 'jump')) return
    this.startDestination({ target, reason: 'jump', align })
  }
  restoreToMessage(
    target: MessageIdentityAnchor,
    options: import('../contracts/options').MessageListRestoreOptions = {},
  ): void {
    if (
      this.alignLocalDestination(
        target,
        options.align ?? 'center',
        options.offsetWithinMessage,
        'restore',
      )
    ) {
      return
    }
    this.startDestination({
      target,
      reason: 'restore',
      align: options.align ?? 'center',
      offsetWithinMessage: options.offsetWithinMessage,
    })
  }
  private alignLocalDestination(
    target: MessageIdentityAnchor,
    align: DestinationIntent['align'],
    offsetWithinMessage?: number,
    reason: DestinationIntent['reason'] = 'jump',
  ): boolean {
    if (!this.domInteractions.alignToMessage(
      this.snapshot,
      target,
      align,
      offsetWithinMessage,
    )) {
      return false
    }
    this.interactions.clearFollowBottom()
    this.interactions.markLocalDestinationSettled()
    this.snapshot = {
      ...this.snapshot,
      bottomLockState: 'UNLOCKED',
      pendingIntent: null,
    }
    this.syncScrollIntentBottomLock()
    this.emitSnapshot()
    this.emitAnchorChanged('transaction-settle', target)
    this.emitDestinationSettled({ target, align, offsetWithinMessage, reason }, target)
    return true
  }
  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic> { return this.snapshot }
  subscribeSnapshot(listener: MessageListSnapshotListener): () => void { this.snapshotListeners.add(listener); return () => this.snapshotListeners.delete(listener) }
  subscribeRuntimeEvent(listener: MessageListRuntimeEventListener): () => void { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener) }
  subscribeViewportObservation(listener: ViewportObservationListener): () => void { return this.subscribeRuntimeEvent((event) => { if (event.type === 'viewportObservationChanged') listener(event) }) }
  getViewportAnchor(): MessageIdentityAnchor | null { return this.lastAnchor ?? this.snapshot.segmentMeta.anchor ?? null }
  getDiagnostics(): import('../contracts/events').ViewportDiagnosticRecord[] { return this.diagnostics.getRecords() }
  getEvidence(): ViewportEvidence { return createViewportEvidence(this.snapshot, this.lastMeasurement, this.pendingTransaction?.token ?? null) }
  registerMessageFlowElement(element: HTMLElement | null): void { this.registry.setMessageFlow(element) }
  registerBeforeTriggerElement(element: HTMLElement | null): void { this.registry.setBeforeTrigger(element); this.domInteractions.registerEdgeTrigger('before', element) }
  registerAfterTriggerElement(element: HTMLElement | null): void { this.registry.setAfterTrigger(element); this.domInteractions.registerEdgeTrigger('after', element) }
  registerBottomMarkerElement(element: HTMLElement | null): void { this.registry.setBottomMarker(element) }
  registerRowElement(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    const previous = this.registry.getRow(key)
    if (previous && previous !== element) this.resizeObserver?.unobserve(previous)
    this.registry.setRow(key, element)
    if (element) this.resizeObserver?.observe(element)
  }
  beginDirectScroll(): void { this.domInteractions.beginDirectScroll() }
  writeDirectScrollTop(scrollTop: number): boolean { return this.domInteractions.writeDirectScrollTop(scrollTop) }
  endDirectScroll(): void { this.domInteractions.endDirectScroll() }
  notifyDirectScrollRebased(): void { this.domInteractions.notifyDirectScrollRebased() }
  reportEdgeRequestFailure(edge: RuntimeEdge, requestToken: string): void { this.snapshot = this.interactions.reportEdgeError(this.snapshot, edge, requestToken); this.emitSnapshot() }
  retryEdgeRequest(edge: RuntimeEdge): void { const update = this.interactions.retryEdge(this.snapshot, edge); if (update) this.applyInteractionUpdate(update) }
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
  private resolveCurrentVisualAnchor(): ResolvedViewportAnchor {
    return resolveCurrentViewportAnchor({
      registry: this.registry,
      snapshot: this.snapshot,
      fallbackAnchor: this.getViewportAnchor(),
      lastAnchor: this.lastAnchor,
      lastAnchorOffsetWithinMessage: this.lastAnchorOffsetWithinMessage,
    })
  }
  private startDestination(intent: DestinationIntent): void {
    this.applyInteractionUpdate(this.interactions.startDestination(this.snapshot, intent))
  }
  private applyInteractionUpdate(
    update: InteractionUpdate<TMessage, TOptimistic>,
  ): void {
    this.snapshot = withNextProjectionRevision(update.snapshot)
    this.syncScrollIntentBottomLock()
    this.emitSnapshot()
    if (
      update.event?.type === 'needMoreBefore' ||
      update.event?.type === 'needMoreAfter'
    ) {
      this.domInteractions.consumeDirectScrollEdgeIntent(
        update.event.edge,
        update.event.requestToken,
      )
    }
    if (update.event) this.emitRuntimeEvent(update.event)
  }
  private handleEdgeIntersection(edge: RuntimeEdge): void {
    const source = this.scrollIntent.classifyCurrentScroll()
    const update = this.interactions.startEdgeNeed(
      this.snapshot,
      edge,
      edge === 'before' ? 'near-before' : 'near-after',
      edge === 'before' ? 'edge-before' : 'edge-after',
      { source },
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
      this.scrollIntent.incrementFrame()
      this.resizeFrame = null
      if (this.pendingTransaction || this.snapshot.viewportPhase !== 'IDLE') {
        this.scheduleResizeMeasurement()
        return
      }
      this.setViewportPhase('MEASURING')
      const anchor = captureVisualAnchor(this.registry.snapshot())
      this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
      this.setViewportPhase('CORRECTING')
      this.domInteractions.preserveVisualAnchor(anchor)
      this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
      this.domInteractions.recordRowMetrics()
      this.stateAxes.setTransactionState('settling')
      this.pushDiagnostic('measurement.resizeDirty', 'info', {
        rowCount: this.lastMeasurement.visibleRows.length,
      })
      this.setViewportPhase('IDLE')
      this.emitViewportObservation('resize')
      this.applyPostCommitInteractionUpdates()
    })
  }
  private handleScrollFrame(): void {
    if (this.pendingTransaction || this.snapshot.viewportPhase !== 'IDLE') {
      return
    }
    const scrollSource = this.scrollIntent.classifyFrameScroll()
    this.lastMeasurement = measureRuntimeDom(this.registry.snapshot(), { rowKeys: this.domInteractions.getScrollSampleKeys() })
    this.snapshot = this.interactions.updateActiveFollowBottomForScroll(
      this.snapshot,
      this.lastMeasurement.scrollTop,
      scrollSource,
    )
    const bottomLockUpdate = this.scrollIntent.updateBottomLock(
      this.snapshot,
      this.lastMeasurement,
      scrollSource,
    )
    this.snapshot = bottomLockUpdate.snapshot
    if (bottomLockUpdate.changed) {
      this.emitSnapshot()
    }
    this.emitViewportObservation('scroll-idle', scrollSource)
    this.emitAnchorChanged('scroll-idle', this.resolveMeasuredViewportAnchor())
  }
  private resolveMeasuredViewportAnchor(): ResolvedViewportAnchor {
    return resolveMeasuredViewportAnchor({
      registry: this.registry,
      snapshot: this.snapshot,
      measurement: this.lastMeasurement,
      fallbackAnchor: this.getViewportAnchor(),
      resolveCurrent: () => this.resolveCurrentVisualAnchor(),
    })
  }
  private setViewportPhase(phase: MessageListSnapshot['viewportPhase']): void {
    this.stateAxes.setTransactionState(resolveTransactionStateForPhase(phase))
    this.snapshot = {
      ...this.snapshot,
      viewportPhase: phase,
    }
    this.emitSnapshot()
  }
  private emitSnapshot(): void { for (const listener of this.snapshotListeners) listener() }
  private startNextQueuedTransaction(): void {
    if (this.pendingTransaction || this.isAdvancingTransactionQueue) {
      return
    }
    const next = this.transactionQueue.shift()
    if (next) {
      this.startTransaction(next)
      return
    }
    if (!this.pendingTransaction) {
      this.stateAxes.setTransactionState('idle')
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
      this.stateAxes.setTransactionState('idle')
    }
    removeQueuedSegmentsBeforeGeneration(this.transactionQueue, generation)
    if (
      generation > this.snapshot.generation &&
      !this.shouldPreservePendingIntentFor(segment)
    ) {
      this.snapshot = this.interactions.resetForGeneration(this.snapshot)
      this.syncScrollIntentBottomLock()
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
    severity: import('../contracts/events').ViewportDiagnosticRecord['severity'],
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
    input: ViewportAnchorEventInput,
  ): void {
    const resolved = resolveViewportAnchorEventInput({
      eventInput: input,
      resolveCurrent: () => this.resolveCurrentVisualAnchor(),
    })
    this.lastAnchor = resolved.anchor
    this.lastAnchorOffsetWithinMessage = resolved.offsetWithinMessage
    this.emitRuntimeEvent({
      type: 'viewportAnchorChanged',
      feedId: this.snapshot.feedId,
      generation: this.snapshot.generation,
      segmentRevision: this.snapshot.segmentRevision,
      reason,
      anchor: resolved.anchor,
      offsetWithinMessage: resolved.offsetWithinMessage,
    })
  }
  private emitViewportObservation(
    reason: ViewportObservationReason,
    scrollSource = this.scrollIntent.getLastScrollSource(),
    input: ViewportAnchorEventInput = this.resolveMeasuredViewportAnchor(),
  ): void {
    const anchor = resolveViewportAnchorEventInput({ eventInput: input, resolveCurrent: () => this.resolveCurrentVisualAnchor() })
    this.emitRuntimeEvent(createViewportObservationEvent({
      snapshot: this.snapshot, measurement: this.lastMeasurement, reason,
      scrollSource, previousScrollTop: this.lastObservationScrollTop, anchor,
    }))
    this.lastObservationScrollTop = this.lastMeasurement.scrollTop
  }
  private emitDestinationSettled(destination: DestinationIntent, resolvedTarget: MessageIdentityAnchor | null): void {
    this.emitRuntimeEvent(createDestinationSettledEvent({ snapshot: this.snapshot, destination, resolvedTarget }))
  }
  private emitViewportReadyOnce(token: ProjectionCommitToken): void {
    const key = `${token.feedId}:${token.generation}`
    if (this.readyGenerationKey === key) {
      return
    }
    this.readyGenerationKey = key
    this.emitRuntimeEvent({
      type: 'viewportReady',
      feedId: token.feedId,
      commitToken: token,
    })
  }
  private emitSegmentTrimPressure(segment: LoadedSegment<TMessage, TOptimistic>, anchor: MessageIdentityAnchor | null): void {
    const event = createSegmentTrimPressureEvent({
      snapshot: this.snapshot,
      segment,
      anchor,
      measurement: this.lastMeasurement,
    })
    if (event) this.emitRuntimeEvent(event)
  }
  private applyPostCommitInteractionUpdates(
    directScrollEdgeIntent: RuntimeEdge | null = null,
  ): void {
    for (const update of createPostCommitInteractionUpdates({
      interactions: this.interactions,
      snapshot: this.snapshot,
      measurement: this.lastMeasurement,
      directScrollEdgeIntent,
      scrollSource: this.scrollIntent.getLastScrollSource(),
      allowDirectScrollEdge: !this.pendingTransaction && this.snapshot.viewportPhase === 'IDLE',
    })) {
      this.applyInteractionUpdate(update)
    }
  }
  private syncScrollIntentBottomLock(): void {
    this.scrollIntent.syncBottomLock(this.snapshot)
  }
  private readCurrentScrollTop(): number {
    return this.registry.snapshot().scrollContainer?.scrollTop ??
      this.lastMeasurement.scrollTop
  }
}
