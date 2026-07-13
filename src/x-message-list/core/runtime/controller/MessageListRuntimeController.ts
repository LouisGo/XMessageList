import { correctTransactionAnchor } from '../dom/anchorCorrection'
import { RuntimeDomRegistry } from '../dom/domRegistry'
import { createViewportEvidence } from '../events/evidence'
import type { MessageIdentityAnchor, MessageRuntimeItemKey } from '../contracts/identity'
import type { MessageListAdapterRuntime } from '../internal'
import { createBrowserObserverFactory, createInitialSnapshot, createSnapshotFromSegment, isSameSegmentToken, isSameToken } from './controllerHelpers'
import { resolveCapturedTransactionAnchor, resolvePendingAnchorKey, resolveTransactionScrollSource, shouldWaitForAnchorRef, type PendingRuntimeMotion, type ProjectionStage } from './controllerTransactionHelpers'
import { withNextProjectionRevision } from '../shared/snapshotIdentity'
import { RuntimeDomInteractions } from '../dom/domInteractions'
import { RuntimeDirtyRangeRegistry } from '../dom/dirtyRange'
import { RuntimeScrollIntentCoordinator } from '../scroll/runtimeScrollIntent'
import { RuntimeInteractionState, type DestinationIntent, type InteractionUpdate, type RuntimeEdge } from '../interactions/interactionState'
import type { MessageListRuntimeEvent, MessageListRuntimeEventListener, ViewportAnchorChangedEvent, ViewportObservationListener, ViewportObservationReason } from '../contracts/events'
import type { LoadedSegment } from '../contracts/segment'
import { RuntimeStateAxes } from '../state/runtimeStateAxes'
import { createResilientScheduler } from './scheduler'
import { captureVisualAnchor, measureRuntimeDom, type VisualAnchor } from '../dom/measurement'
import type { MessageListRuntimeOptions, RuntimeScheduler } from '../contracts/options'
import type { MessageListSnapshot, MessageListSnapshotListener, ProjectionCommitToken, ViewportEvidence } from '../contracts/snapshot'
import type { RuntimeSegmentSizeSnapshot } from '../dom/rowMetricCache'
import { createPostCommitInteractionUpdates } from '../interactions/postCommitInteractions'
import { ProjectionTransactionQueue } from './transactionQueue'
import { settleTransactionScrollPosition } from '../transactions/transactionSettlement'
import { resolveCurrentViewportAnchor, resolveMeasuredViewportAnchor, type ResolvedViewportAnchor, type ViewportAnchorEventInput } from '../dom/viewportAnchorEvents'
import { ControllerMotionCoordinator } from './controllerMotionCoordinator'
import { startPendingRuntimeMotion as startPendingRuntimeMotionContinuation } from './controllerSettledContinuations'
import { createCommandEdgeRequest, createViewportEdgeRequest } from './controllerEdgeRequests'
import { createMeasurementCacheContext, createSegmentSizeSnapshot, handleResizeEntries as handleResizeEntriesFromMeasurement, handleScrollFrame as handleScrollFrameFromMeasurement, scheduleResizeMeasurementFrame, type RuntimeControllerMeasurementHost } from './controllerMeasurement'
import { emitMeasurementDiagnostics, emitSettledTransactionMeasurementDiagnostics, measureTransactionFinal, measureTransactionPrecheck } from './controllerMeasurementDiagnostics'
import { ControllerEventPublisher } from './controllerEventPublisher'
import { commitEdgeSlotProjection, prepareEdgeSlotProjection, type PendingEdgeSlotProjection } from './controllerEdgeSlotProjection'
import { markSegmentDirty } from './controllerSegmentDirty'
import { probeInvalidateAfterSafety as probeInvalidateAfterSafetyState } from './controllerInvalidateAfterSafety'
import {
  applyLoadedProjectionTransaction,
  cancelStagedProjectionTransaction,
  rollbackStagedProjection,
  stageLoadedProjectionTransaction,
  type ProjectionTransactionHost,
} from './controllerProjectionTransactions'
export class MessageListRuntimeController<TMessage = unknown, TOptimistic = unknown> implements MessageListAdapterRuntime<TMessage, TOptimistic> {
  private readonly scheduler: RuntimeScheduler
  private readonly sessionId: string
  private readonly registry = new RuntimeDomRegistry()
  private readonly events: ControllerEventPublisher<TMessage, TOptimistic>
  private readonly interactions: RuntimeInteractionState<TMessage, TOptimistic>
  private readonly stateAxes = new RuntimeStateAxes()
  private readonly scrollIntent: RuntimeScrollIntentCoordinator
  private readonly domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  private readonly transactions = new ProjectionTransactionQueue<TMessage, TOptimistic>()
  private readonly motion: ControllerMotionCoordinator<TMessage, TOptimistic>
  private readonly snapshotListeners = new Set<MessageListSnapshotListener>()
  private snapshot: MessageListSnapshot<TMessage, TOptimistic>
  private lastMeasurement = measureRuntimeDom(this.registry.snapshot())
  private lastAnchor: MessageIdentityAnchor | null = null
  private lastAnchorOffsetWithinMessage: number | undefined
  private pendingRuntimeMotion: PendingRuntimeMotion<TMessage, TOptimistic> | null = null
  private pendingEdgeSlotProjection: PendingEdgeSlotProjection | null = null
  private readonly resizeObserver: ResizeObserver | null = null
  private readonly dirtyRange = new RuntimeDirtyRangeRegistry()
  private readonly rowKeyByElement = new Map<HTMLElement, MessageRuntimeItemKey>()
  private resizeFrame: number | null = null
  private destroyed = false
  constructor(private readonly options: MessageListRuntimeOptions) {
    this.sessionId = options.sessionId ?? 'default'
    this.scheduler = createResilientScheduler(options.scheduler)
    const observerFactory = options.observers ?? createBrowserObserverFactory()
    this.events = new ControllerEventPublisher(this.scheduler, {
      getSnapshot: () => this.snapshot,
      getMeasurement: () => this.lastMeasurement,
      resolveCurrentAnchor: () => this.resolveCurrentVisualAnchor(),
      setLastAnchor: (resolved) => { this.lastAnchor = resolved.anchor; this.lastAnchorOffsetWithinMessage = resolved.offsetWithinMessage },
    })
    this.interactions = new RuntimeInteractionState(this.stateAxes, options.underflowTolerancePx, options.edgeActivationMarginPx)
    this.scrollIntent = new RuntimeScrollIntentCoordinator(options)
    this.domInteractions = new RuntimeDomInteractions({
      scheduler: this.scheduler,
      observerFactory,
      registry: this.registry,
      onEdgeIntersect: (edge) => this.handleEdgeIntersection(edge),
      onScrollWrite: (source) => { this.scrollIntent.markScrollWrite(source); this.transactions.recordScrollWrite() },
      onUserScrollIntent: () => this.handleUserScrollIntent(),
      onScrollFrame: () => this.handleScrollFrame(),
      edgeActivationMarginPx: options.edgeActivationMarginPx,
      onDiagnostic: (name, severity, details) => this.pushDiagnostic(name, severity, details),
    })
    this.snapshot = createInitialSnapshot<TMessage, TOptimistic>(this.sessionId)
    this.motion = new ControllerMotionCoordinator({ scheduler: this.scheduler, options: options.scrollMotion, host: {
        stateAxes: this.stateAxes,
        getSnapshot: () => this.snapshot,
        setSnapshot: (snapshot) => { this.snapshot = snapshot },
        emitSnapshot: () => this.emitSnapshot(),
        getScrollContainer: () => this.domInteractions.getScrollContainer(),
        getBottomTargetTop: () => this.domInteractions.getBottomTargetTop(),
        resolveAlignedScrollTarget: (snapshot, target, align, offsetWithinMessage) =>
          this.domInteractions.resolveAlignedScrollTarget(snapshot, target, align, offsetWithinMessage),
        writeProgrammaticScroll: (container, scrollTop, source) =>
          this.domInteractions.writeProgrammaticScroll(container, scrollTop, source),
        measureRuntimeDom: () => {
          this.lastMeasurement = measureRuntimeDom(this.registry.snapshot())
          emitMeasurementDiagnostics(this.pushDiagnostic.bind(this), this.lastMeasurement, 'transaction')
          return this.lastMeasurement
        },
        recordRowMetrics: (measurement) => this.domInteractions.recordRowMetrics(measurement, createMeasurementCacheContext(this.snapshot, 'transaction')),
        setViewportPhase: (phase) => this.setViewportPhase(phase),
        syncScrollIntentBottomLock: () => this.syncScrollIntentBottomLock(),
        clearFollowBottom: () => this.interactions.clearFollowBottom(),
        markLocalDestinationSettled: () => this.interactions.markLocalDestinationSettled(),
        readCurrentScrollTop: () => this.readCurrentScrollTop(),
        pushDiagnostic: (name, severity, details) => this.pushDiagnostic(name, severity, details),
        emitViewportObservation: (reason, source, anchor) => this.emitViewportObservation(reason, source, anchor),
        emitAnchorChanged: (reason, anchor) => this.emitAnchorChanged(reason, anchor),
        emitDestinationSettled: (destination, anchor) => this.emitDestinationSettled(destination, anchor),
        emitProjectionSettled: (token, status) => this.emitProjectionSettled(token, status),
        continueAfterMotionSettle: () => this.applySettledTransactionContinuations(),
      } })
    this.resizeObserver = observerFactory?.createResizeObserver((entries) => {
      handleResizeEntriesFromMeasurement(this.measurementHost(), entries)
      this.scheduleResizeMeasurement()
    }) ?? null
  }
  attachScrollContainer(container: HTMLElement): void {
    if (this.rejectAfterDestroy('attachScrollContainer')) return
    const previous = this.registry.snapshot().scrollContainer
    if (previous && previous !== container) this.resizeObserver?.unobserve(previous)
    this.domInteractions.attachScrollContainer(container)
    this.resizeObserver?.observe(container)
  }
  detachScrollContainer(): void {
    if (this.rejectAfterDestroy('detachScrollContainer')) return
    this.cancelPendingRuntimeMotion()
    this.motion.cancel('detach')
    const anchor = this.resolveCurrentVisualAnchor()
    this.emitAnchorChanged('detach', anchor)
    this.emitViewportObservation('detach', null, anchor)
    const container = this.registry.snapshot().scrollContainer; if (container) this.resizeObserver?.unobserve(container)
    this.domInteractions.detachScrollContainer()
    for (const row of this.registry.clearAll()) this.resizeObserver?.unobserve(row)
    this.rowKeyByElement.clear()
    this.dirtyRange.clear()
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const pending = this.transactions.getPending()
    if (pending) this.scheduler.clearTimeout(pending.timeoutHandle)
    if (this.resizeFrame !== null) this.scheduler.cancelAnimationFrame(this.resizeFrame)
    this.resizeObserver?.disconnect()
    this.domInteractions.detachScrollContainer()
    this.registry.clearAll()
    this.rowKeyByElement.clear()
    this.dirtyRange.clear()
    this.transactions.clear()
    this.pendingEdgeSlotProjection = null
    this.motion.reset()
    this.resizeFrame = null
    this.snapshotListeners.clear()
    this.events.clear()
  }
  applyLoadedSegment(segment: LoadedSegment<TMessage, TOptimistic>): void { applyLoadedProjectionTransaction(this.projectionTransactionHost(), segment) }
  /**
   * structural reload 使用可撤销 stage：它绝不抢占当前 transaction/motion，也不会在
   * DOM ack 前成为主 store 的 authoritative segment。
   */
  stageLoadedSegment(
    segment: LoadedSegment<TMessage, TOptimistic>,
    stage: ProjectionStage,
  ): boolean {
    return stageLoadedProjectionTransaction(this.projectionTransactionHost(), segment, stage)
  }
  cancelStagedProjection(segment: Pick<ProjectionCommitToken, 'sessionId' | 'generation' | 'segmentRevision'>): boolean {
    return cancelStagedProjectionTransaction(this.projectionTransactionHost(), segment)
  }
  private startTransaction(
    segment: LoadedSegment<TMessage, TOptimistic>,
    stage?: ProjectionStage,
  ): void {
    this.motion.cancel('transaction-supersede')
    const rollbackSnapshot = stage ? this.snapshot : undefined
    markSegmentDirty(segment, this.measurementHost())
    const projectionRevision = this.snapshot.projectionRevision + 1
    const token = { sessionId: segment.sessionId, generation: segment.generation, segmentRevision: segment.segmentRevision, projectionRevision }
    const anchor = resolveCapturedTransactionAnchor(captureVisualAnchor(this.registry.snapshot()), segment, this.registry) // React commit 前捕获 visual anchor；删除末尾 anchor 时 predecessor 使用自身旧几何。
    this.pendingEdgeSlotProjection = null
    const timeoutHandle = this.scheduler.setTimeout(() => this.handleCommitTimeout(token), this.options.commitTimeoutMs ?? 120)
    this.transactions.setPending({ token, segment, anchor, timeoutHandle, startedAt: this.scheduler.now(), anchorRetryCount: 0, scrollWriteCount: 0, stage, rollbackSnapshot })
    this.stateAxes.markTransactionActive()
    const previous = this.interactions.projectEdgeStateForSegment(this.snapshot, segment)
    this.snapshot = createSnapshotFromSegment(segment, { previous, projectionRevision, viewportPhase: 'PROJECTING' })
    this.emitSnapshot()
  }
  ackProjectionCommit(token: ProjectionCommitToken): void {
    const edgeMeasurement = commitEdgeSlotProjection({ pending: this.pendingEdgeSlotProjection, token, registry: this.registry, domInteractions: this.domInteractions, pushDiagnostic: (name, severity, details) => this.pushDiagnostic(name, severity, details) })
    if (edgeMeasurement) {
      this.pendingEdgeSlotProjection = null
      this.lastMeasurement = edgeMeasurement
      this.domInteractions.recordRowMetrics(this.lastMeasurement, createMeasurementCacheContext(this.snapshot, 'transaction'))
      return
    }
    const pending = this.transactions.getPending()
    if (!pending || !isSameToken(pending.token, token)) {
      if (!pending && isSameSegmentToken(this.snapshot.commitToken, token)) {
        return
      }
      this.pushDiagnostic('transaction.staleCommitAck', 'warn', token)
      return
    }
    this.scheduler.clearTimeout(pending.timeoutHandle)
    if (pending.stage && !pending.stage.commit()) {
      this.transactions.clearPending()
      this.pushDiagnostic('transaction.stageCommitRejected', 'warn', token)
      this.rollbackStagedTransaction(pending)
      return
    }
    this.continueCommittedTransaction(token)
  }
  private continueCommittedTransaction(token: ProjectionCommitToken): void {
    const pending = this.transactions.getPending()
    if (!pending || !isSameToken(pending.token, token)) {
      return
    }
    this.transactions.beginAdvancing()
    let settled = false
    try {
      this.scrollIntent.incrementFrame()
      this.stateAxes.markTransactionMeasuring()
      this.setViewportPhase('MEASURING')
      const precheck = measureTransactionPrecheck({ pushDiagnostic: this.pushDiagnostic.bind(this), pending, snapshot: this.snapshot, registry: this.registry, domInteractions: this.domInteractions, dirtyRange: this.dirtyRange })
      this.lastMeasurement = precheck.measurement
      if (shouldWaitForAnchorRef(pending, this.registry)) { // React 可能先 ack 父级 commit，目标 row ref 下一帧才注册；只等一帧，避免无限挂起。
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
      this.stateAxes.markTransactionCorrecting()
      this.setViewportPhase('CORRECTING')
      const destination = this.interactions.getPendingDestination()
      const transactionScrollSource = resolveTransactionScrollSource({ snapshot: this.snapshot, segment: pending.segment, destination })
      if (pending.segment.modifier.type === 'reset-around') {
        this.interactions.markPendingDestinationResolvingDom()
      }
      const scrollSettlement = settleTransactionScrollPosition({
        snapshot: this.snapshot,
        segment: pending.segment,
        capturedAnchor: pending.anchor,
        destination,
        activeFollowBottom: this.interactions.hasActiveFollowBottom(this.snapshot),
        domInteractions: this.domInteractions,
        correctAnchor: (anchor, segment) => this.correctAnchor(anchor, segment),
        getViewportAnchor: () => this.getViewportAnchor(),
      })
      const { measurement: finalMeasurement, plan: finalPlan } = measureTransactionFinal({ pushDiagnostic: this.pushDiagnostic.bind(this), pending, registry: this.registry, domInteractions: this.domInteractions, dirtyRange: precheck.dirtyRange })
      this.lastMeasurement = finalMeasurement
      this.domInteractions.recordRowMetrics(this.lastMeasurement, createMeasurementCacheContext(this.snapshot, 'transaction'))
      this.dirtyRange.clear()
      this.stateAxes.markTransactionSettling()
      this.snapshot = this.interactions.settleSegment(this.snapshot, pending.segment)
      if (scrollSettlement.kind === 'instant' && scrollSettlement.bottomLockState) this.snapshot = { ...this.snapshot, bottomLockState: scrollSettlement.bottomLockState }
      this.domInteractions.settleDirectScrollSegment(pending.segment.modifier)
      this.syncScrollIntentBottomLock()
      this.transactions.clearPending()
      this.stateAxes.markTransactionIdle()
      const shouldStartRuntimeMotion = scrollSettlement.kind === 'motion'
      if (shouldStartRuntimeMotion) { // 先完成事务 settle，再让 continuation 启动 motion；队列里更高优先级事务仍可先执行。
        this.pendingRuntimeMotion = { commitToken: token, settlement: scrollSettlement, scrollSource: transactionScrollSource, segment: pending.segment }
      }
      const latencyMs = this.scheduler.now() - pending.startedAt
      emitSettledTransactionMeasurementDiagnostics({
        pushDiagnostic: this.pushDiagnostic.bind(this),
        pending, precheck,
        finalMeasurement, finalPlan,
        latencyMs,
      })
      if (!shouldStartRuntimeMotion) this.emitProjectionSettled(token, 'applied')
      this.emitViewportReadyOnce(token)
      if (shouldStartRuntimeMotion) settled = true
      else {
        this.setViewportPhase('IDLE')
        this.emitViewportObservation('transaction-settle', transactionScrollSource, scrollSettlement.anchor)
        this.emitAnchorChanged('transaction-settle', scrollSettlement.anchor)
        if (destination && pending.segment.modifier.type === 'reset-around') this.emitDestinationSettled(destination, scrollSettlement.anchor)
        this.emitSegmentTrimPressure(pending.segment, scrollSettlement.anchor)
        settled = true
      }
    } finally {
      this.transactions.endAdvancing()
    }
    if (settled) this.applySettledTransactionContinuations()
  }
  private handleCommitTimeout(token: ProjectionCommitToken): void {
    const pending = this.transactions.clearPendingToken(token)
    if (!pending) return
    this.transactions.beginAdvancing()
    try {
      if (pending.stage) {
        this.rollbackStagedTransaction(pending)
        this.pushDiagnostic('transaction.commitTimeout', 'error', token)
        this.emitRuntimeEvent({ type: 'viewportError', sessionId: token.sessionId, code: 'commit-timeout', message: 'Projection commit timed out.' })
        this.emitProjectionSettled(token, 'commit-timeout')
      } else {
        this.applyInteractionProjection(this.interactions.resetForGeneration(this.snapshot))
        this.stateAxes.markTransactionIdle()
        this.setViewportPhase('IDLE')
        this.pushDiagnostic('transaction.commitTimeout', 'error', token)
        this.emitRuntimeEvent({ type: 'viewportError', sessionId: token.sessionId, code: 'commit-timeout', message: 'Projection commit timed out.' })
        this.emitProjectionSettled(token, 'commit-timeout')
      }
    } finally {
      this.transactions.endAdvancing()
    }
    this.applySettledTransactionContinuations({ evaluatePostCommitInteractions: false })
  }
  private rollbackStagedTransaction(
    pending: import('./controllerTransactionHelpers').PendingTransaction<TMessage, TOptimistic>,
  ): void {
    rollbackStagedProjection({
      scheduler: this.scheduler,
      clearPendingEdgeSlotProjection: () => { this.pendingEdgeSlotProjection = null },
      dirtyRange: this.dirtyRange,
      restoreSnapshot: (snapshot) => { this.snapshot = snapshot },
      markTransactionIdle: () => this.stateAxes.markTransactionIdle(),
      syncScrollIntentBottomLock: () => this.syncScrollIntentBottomLock(),
      emitSnapshot: () => this.emitSnapshot(),
    }, pending)
  }
  private applySettledTransactionContinuations(options: { evaluatePostCommitInteractions?: boolean } = {}): void { // continuation 顺序固定：队列事务 > 延迟 motion > post-commit underflow/direct-scroll。
    if (this.startNextQueuedTransaction()) return
    if (this.startPendingRuntimeMotion()) return
    if (options.evaluatePostCommitInteractions === false) return
    this.motion.reservePostCommitOpportunity()
    if (
      !this.motion.consumePostCommitOpportunity() &&
      this.snapshot.viewportPhase === 'IDLE'
    ) {
      this.applyPostCommitInteractionUpdates(this.domInteractions.getDirectScrollEdgeIntent())
    }
  }
  scrollToLatest(): void {
    if (this.rejectAfterDestroy('scrollToLatest')) return
    this.cancelCommandMotion()
    const update = this.interactions.startFollowBottom(
      this.snapshot,
      this.readCurrentScrollTop(),
    )
    this.applyInteractionUpdate(update)
    if (!update.event) {
      if (!this.isAtBottomTarget()) {
        this.motion.startBottom('followBottom', this.getViewportAnchor())
      } else {
        this.interactions.clearFollowBottom()
      }
    }
  }
  scrollToMessage(
    target: MessageIdentityAnchor,
    options: import('../contracts/options').MessageListScrollToMessageOptions = {},
  ): void {
    if (this.rejectAfterDestroy('scrollToMessage')) return
    this.cancelCommandMotion()
    const align = options.align ?? 'center'
    if (this.motion.alignLocalDestination(target, align, undefined, 'jump', options.motion)) return
    this.startDestination({ target, reason: 'jump', align, motion: options.motion })
  }
  restoreToMessage(
    target: MessageIdentityAnchor,
    options: import('../contracts/options').MessageListRestoreOptions = {},
  ): void {
    if (this.rejectAfterDestroy('restoreToMessage')) return
    this.cancelCommandMotion()
    if (this.motion.alignLocalDestination(target, options.align ?? 'center', options.offsetWithinMessage, 'restore')) return
    this.startDestination({ target, reason: 'restore', align: options.align ?? 'center', offsetWithinMessage: options.offsetWithinMessage })
  }
  private handleUserScrollIntent(): void {
    this.emitRuntimeEvent({ type: 'viewportNavigationIntent', sessionId: this.snapshot.sessionId, generation: this.snapshot.generation, segmentRevision: this.snapshot.segmentRevision, reason: 'user-scroll' })
    this.cancelPendingRuntimeMotion()
    const destinationUpdate = this.interactions.interruptDestinationForUserInput(this.snapshot)
    if (destinationUpdate) this.applyInteractionUpdate(destinationUpdate)
    const nextSnapshot = this.interactions.cancelUnderflowFill(this.snapshot)
    if (nextSnapshot !== this.snapshot) {
      this.applyInteractionProjection(nextSnapshot)
      this.emitSnapshot()
    }
    this.motion.cancel('user-interrupt')
    this.scrollIntent.markUserScrollIntent()
  }
  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic> { return this.snapshot }
  subscribeSnapshot(listener: MessageListSnapshotListener): () => void { this.snapshotListeners.add(listener); return () => this.snapshotListeners.delete(listener) }
  subscribeRuntimeEvent(listener: MessageListRuntimeEventListener): () => void { return this.events.subscribe(listener) }
  subscribeViewportObservation(listener: ViewportObservationListener): () => void { return this.subscribeRuntimeEvent((event) => { if (event.type === 'viewportObservationChanged') listener(event) }) }
  getViewportAnchor(): MessageIdentityAnchor | null { return this.lastAnchor ?? this.snapshot.segmentMeta.anchor ?? null }
  getViewportAnchorMemory(): { anchor: MessageIdentityAnchor; offsetWithinMessage?: number } | null { const resolved = this.resolveCurrentVisualAnchor()
    if (!resolved.anchor) return null
    if (resolved.offsetWithinMessage === undefined) return { anchor: resolved.anchor }
    return { anchor: resolved.anchor, offsetWithinMessage: resolved.offsetWithinMessage }
  }
  getDiagnostics(): import('../contracts/events').ViewportDiagnosticRecord[] { return this.events.getDiagnostics() }
  getEvidence(): ViewportEvidence { return createViewportEvidence(this.snapshot, this.lastMeasurement, this.transactions.getPending()?.token ?? null) }
  registerMessageFlowElement(element: HTMLElement | null): void { if (this.rejectAfterDestroy('registerMessageFlowElement')) return; this.registry.setMessageFlow(element) }
  registerBeforeTriggerElement(element: HTMLElement | null): void { if (this.rejectAfterDestroy('registerBeforeTriggerElement')) return; this.registry.setBeforeTrigger(element); this.domInteractions.registerEdgeTrigger('before', element) }
  registerAfterTriggerElement(element: HTMLElement | null): void { if (this.rejectAfterDestroy('registerAfterTriggerElement')) return; this.registry.setAfterTrigger(element); this.domInteractions.registerEdgeTrigger('after', element) }
  registerBottomMarkerElement(element: HTMLElement | null): void { if (this.rejectAfterDestroy('registerBottomMarkerElement')) return; this.registry.setBottomMarker(element) }
  registerRowElement(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    if (this.rejectAfterDestroy('registerRowElement')) return
    const previous = this.registry.getRow(key)
    if (previous && previous !== element) {
      this.resizeObserver?.unobserve(previous)
      this.rowKeyByElement.delete(previous)
      this.domInteractions.deleteRowMetric(key)
      this.dirtyRange.deleteKey(key)
    }
    this.registry.setRow(key, element)
    if (element) {
      this.rowKeyByElement.set(element, key)
      this.dirtyRange.markDirty(key, 'resize')
      this.domInteractions.markRowMetricDirty(key)
      this.resizeObserver?.observe(element)
    }
  }
  beginDirectScroll(): void { if (this.rejectAfterDestroy('beginDirectScroll')) return; this.domInteractions.beginDirectScroll() }
  writeDirectScrollTop(scrollTop: number): boolean { if (this.rejectAfterDestroy('writeDirectScrollTop')) return false; return this.domInteractions.writeDirectScrollTop(scrollTop) }
  endDirectScroll(): void { if (this.rejectAfterDestroy('endDirectScroll')) return; this.domInteractions.endDirectScroll() }
  notifyDirectScrollRebased(): void { if (this.rejectAfterDestroy('notifyDirectScrollRebased')) return; this.domInteractions.notifyDirectScrollRebased() }
  reportEdgeRequestFailure(edge: RuntimeEdge, requestToken: string): void { const next = this.interactions.reportEdgeError(this.snapshot, edge, requestToken); if (next !== this.snapshot) { this.applyInteractionProjection(next); this.emitSnapshot() } } reportEdgeRequestStale(edge: RuntimeEdge, requestToken: string): void { const next = this.interactions.reportEdgeStale(this.snapshot, edge, requestToken); if (next !== this.snapshot) { this.applyInteractionProjection(next); this.emitSnapshot() } }
  startEdgeRequest(edge: RuntimeEdge, reason: string): void { if (this.rejectAfterDestroy('startEdgeRequest')) return; const update = createCommandEdgeRequest({ interactions: this.interactions, snapshot: this.snapshot, edge, reason }); if (update) this.applyInteractionUpdate(update) }
  retryEdgeRequest(edge: RuntimeEdge): void { if (this.rejectAfterDestroy('retryEdgeRequest')) return; const update = this.interactions.retryEdge(this.snapshot, edge); if (update) this.applyInteractionUpdate(update) }
  reportOverlayMetricMismatch(details: Record<string, unknown>): void { this.pushDiagnostic('overlay.metricMismatch', 'warn', details) }
  reportOverlayDiagnostic(name: string, details: Record<string, unknown>): void { if (name.startsWith('overlay.')) this.pushDiagnostic(name, 'debug', details) }
  getSegmentSizeSnapshot(): RuntimeSegmentSizeSnapshot { return createSegmentSizeSnapshot(this.measurementHost()) }
  probeInvalidateAfterSafety(input: { suffixKeys: MessageRuntimeItemKey[] }): 'safe' | 'runtime-busy' | 'visible-range-overlap' { return probeInvalidateAfterSafetyState({ suffixKeys: input.suffixKeys, isRuntimeBusy: () => this.destroyed || this.snapshot.viewportPhase !== 'IDLE' || this.transactions.isBusy() || this.motion.isActive() || this.pendingRuntimeMotion !== null || this.domInteractions.hasPendingScrollFrame() || this.domInteractions.isDirectScrollActive(), measureSuffix: (rowKeys) => measureRuntimeDom(this.registry.snapshot(), { rowKeys }) }) }
  prepareFollowBottomForLocalReset(): void { if (this.rejectAfterDestroy('prepareFollowBottomForLocalReset')) return; this.cancelCommandMotion(); this.applyInteractionUpdate(this.interactions.startFollowBottomForLocalReset(this.snapshot, this.readCurrentScrollTop())) }
  reportSessionDiagnostic(name: string, severity: 'debug' | 'info' | 'warn' | 'error', details: Record<string, unknown> = {}): void { this.pushDiagnostic(name, severity, { sessionId: this.snapshot.sessionId, ...details }) }
  private correctAnchor(
    anchor: VisualAnchor | null,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageIdentityAnchor | null {
    return correctTransactionAnchor({
      anchor, segment, snapshot: this.snapshot, registry: this.registry, domInteractions: this.domInteractions,
      pushDiagnostic: (name, severity, details) => this.pushDiagnostic(name, severity, details),
      emitRuntimeEvent: (event) => this.emitRuntimeEvent(event),
    })
  }
  private resolveCurrentVisualAnchor(): ResolvedViewportAnchor {
    return resolveCurrentViewportAnchor({
      registry: this.registry, snapshot: this.snapshot, fallbackAnchor: this.getViewportAnchor(), lastAnchor: this.lastAnchor,
      lastAnchorOffsetWithinMessage: this.lastAnchorOffsetWithinMessage,
    })
  }
  private startDestination(intent: DestinationIntent): void { this.applyInteractionUpdate(this.interactions.startDestination(this.snapshot, intent)) }
  private cancelCommandMotion(): void {
    this.cancelPendingRuntimeMotion()
    const next = this.interactions.cancelUnderflowFill(this.snapshot)
    if (next !== this.snapshot) { this.applyInteractionProjection(next); this.emitSnapshot() }
    this.motion.cancel('command-supersede')
  }
  private startPendingRuntimeMotion(): boolean {
    const pendingMotion = this.pendingRuntimeMotion
    if (!pendingMotion) return false
    this.pendingRuntimeMotion = null
    return startPendingRuntimeMotionContinuation(pendingMotion, {
      motion: this.motion,
      setViewportPhase: (phase) => this.setViewportPhase(phase),
      emitViewportObservation: (reason, source, anchor) => this.emitViewportObservation(reason, source, anchor),
      emitAnchorChanged: (reason, anchor) => this.emitAnchorChanged(reason, anchor),
      emitDestinationSettled: (destination, anchor) => this.emitDestinationSettled(destination, anchor),
      emitSegmentTrimPressure: (segment, anchor) => this.emitSegmentTrimPressure(segment, anchor),
      emitProjectionSettled: (token, status) => this.emitProjectionSettled(token, status),
    })
  }
  private cancelPendingRuntimeMotion(): void {
    const pending = this.pendingRuntimeMotion
    if (!pending) return
    this.pendingRuntimeMotion = null
    this.emitProjectionSettled(pending.commitToken, 'motion-cancelled')
  }
  private applyInteractionUpdate(
    update: InteractionUpdate<TMessage, TOptimistic>,
  ): void {
    this.applyInteractionProjection(update.snapshot)
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
  private applyInteractionProjection(nextSnapshot: MessageListSnapshot<TMessage, TOptimistic>): void {
    const previous = this.snapshot
    const next = withNextProjectionRevision(nextSnapshot)
    const edgeProjection = prepareEdgeSlotProjection({ previous, next, registry: this.registry })
    if (edgeProjection) this.pendingEdgeSlotProjection = edgeProjection
    else if (this.pendingEdgeSlotProjection) this.pendingEdgeSlotProjection.token = next.commitToken
    this.snapshot = next
  }
  private handleEdgeIntersection(edge: RuntimeEdge): void {
    const update = createViewportEdgeRequest({ interactions: this.interactions, snapshot: this.snapshot, edge, source: this.scrollIntent.classifyCurrentScroll() })
    if (update) this.applyInteractionUpdate(update)
  }
  private scheduleResizeMeasurement(): void { scheduleResizeMeasurementFrame(this.measurementHost()) }
  private handleScrollFrame(): void { handleScrollFrameFromMeasurement(this.measurementHost()) }
  private resolveMeasuredViewportAnchor(): ResolvedViewportAnchor {
    return resolveMeasuredViewportAnchor({
      registry: this.registry, snapshot: this.snapshot, measurement: this.lastMeasurement, fallbackAnchor: this.getViewportAnchor(),
      resolveCurrent: () => this.resolveCurrentVisualAnchor(),
    })
  }
  private setViewportPhase(phase: MessageListSnapshot['viewportPhase']): void {
    this.stateAxes.markTransactionForViewportPhase(phase)
    this.snapshot = { ...this.snapshot, viewportPhase: phase }
    this.emitSnapshot()
  }
  private emitSnapshot(): void { for (const listener of this.snapshotListeners) listener() }
  private startNextQueuedTransaction(): boolean {
    const next = this.transactions.dequeueReady(this.snapshot)
    if (next) {
      this.startTransaction(next.segment, next.stage)
      return true
    }
    if (!this.transactions.hasPending()) {
      this.stateAxes.markTransactionIdle()
    }
    return false
  }
  private projectionTransactionHost(): ProjectionTransactionHost<TMessage, TOptimistic> {
    return {
      sessionId: this.sessionId, getSnapshot: () => this.snapshot, interactions: this.interactions,
      transactions: this.transactions, scheduler: this.scheduler, isMotionActive: () => this.motion.isActive(),
      rejectAfterDestroy: (operation) => this.rejectAfterDestroy(operation), markTransactionIdle: () => this.stateAxes.markTransactionIdle(),
      cancelPendingRuntimeMotion: () => this.cancelPendingRuntimeMotion(), resetSnapshot: (snapshot) => { this.snapshot = snapshot },
      syncScrollIntentBottomLock: () => this.syncScrollIntentBottomLock(), startTransaction: (segment, stage) => this.startTransaction(segment, stage),
      markTransactionQueued: () => this.stateAxes.markTransactionQueued(),
      pushDiagnostic: (name, severity, details) => this.pushDiagnostic(name, severity, details),
      rollbackStagedTransaction: (pending) => this.rollbackStagedTransaction(pending), applySettledTransactionContinuations: (options) => this.applySettledTransactionContinuations(options),
    }
  }
  private pushDiagnostic(
    name: string,
    severity: import('../contracts/events').ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ): void { this.events.pushDiagnostic(name, severity, details) }
  private rejectAfterDestroy(operation: string): boolean {
    if (!this.destroyed) return false
    this.pushDiagnostic('runtime.destroyedOperation', 'warn', { operation })
    return true
  }
  private emitRuntimeEvent(event: MessageListRuntimeEvent): void { this.events.emit(event) }
  private emitAnchorChanged(
    reason: ViewportAnchorChangedEvent['reason'],
    input: ViewportAnchorEventInput,
  ): void { this.events.emitAnchorChanged(reason, input) }
  private emitViewportObservation(
    reason: ViewportObservationReason,
    scrollSource = this.scrollIntent.getLastScrollSource(),
    input: ViewportAnchorEventInput = this.resolveMeasuredViewportAnchor(),
  ): void { this.events.emitViewportObservation(reason, scrollSource, input) }
  private emitDestinationSettled(destination: DestinationIntent, resolvedTarget: MessageIdentityAnchor | null): void {
    this.events.emitDestinationSettled(destination, resolvedTarget)
  }
  private emitViewportReadyOnce(token: ProjectionCommitToken): void { this.events.emitViewportReadyOnce(token) }
  private emitProjectionSettled(
    token: ProjectionCommitToken,
    status: 'applied' | 'commit-timeout' | 'motion-cancelled',
  ): void { this.events.emitProjectionSettled(token, status) }
  private emitSegmentTrimPressure(segment: LoadedSegment<TMessage, TOptimistic>, anchor: MessageIdentityAnchor | null): void {
    this.events.emitSegmentTrimPressure(segment, anchor)
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
      allowDirectScrollEdge: !this.transactions.hasPending() && this.snapshot.viewportPhase === 'IDLE',
    })) {
      this.applyInteractionUpdate(update)
    }
  }
  private syncScrollIntentBottomLock(): void {
    this.scrollIntent.syncBottomLock(this.snapshot)
  }
  private readCurrentScrollTop(): number { return this.registry.snapshot().scrollContainer?.scrollTop ?? this.lastMeasurement.scrollTop }
  private isAtBottomTarget(): boolean { const targetTop = this.domInteractions.getBottomTargetTop(); return targetTop !== null && Math.abs(targetTop - this.readCurrentScrollTop()) <= 1 }
  private measurementHost(): RuntimeControllerMeasurementHost<TMessage, TOptimistic> {
    return this as unknown as RuntimeControllerMeasurementHost<TMessage, TOptimistic>
  }
}
