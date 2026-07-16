import { createMessageListRuntime, type LoadedSegment, type MessageDataItem, type MessageIdentityAnchor, type MessageListRuntime, type MessageListRuntimeEvent, type MessageListSnapshot } from '../../runtime/index'
import { createLoadedSegmentStore, type LoadedSegmentRequestKind, type LoadedSegmentStore } from '../loaded-segment-store/index'
import { getMessageListSessionRegistryRuntime } from '../../runtime/internal'
import type { RuntimeSegmentSizeSnapshot } from '../../runtime/dom/rowMetricCache'
import { MessageListReadReceiptsWorker } from '../read-receipts/readReceipts'
import { MessageListSessionOverlay } from './overlay'
import { createMessageListSessionBootstrapController, type MessageListSessionBootstrapController } from './bootstrap'
import { toSessionRuntimeLogEvent } from './runtimeLogEvent'
import { createMessageListSessionState } from './state'
import { createSessionRows } from '../rows/sessionRows'
import { defineMessageListSessionInternals } from '../internal'
import { MessageListSessionLiveSemantics } from '../tail/tailSemantics'
import { assertAroundPageTargetContract, assertLatestPageContract, assertReachedLatestContract, reportContractDiagnostic } from './contractDiagnostics'
import { resolveRequestTriggerFromEvent, toRuntimeScrollOptions, toSessionResetInput, type AroundRequestOptions, type RuntimeNeedEvent, type SessionOptions } from './helpers'
import type { MessageListRequestTrigger, MessageListRequestResult, MessageListSessionId, MessageListSession as PublicMessageListSession, MessageListSessionContext, MessageListSessionState, MessageListViewState } from '../contracts'
import { MessageListAnchorMemoryWriter } from './anchorMemoryWriter'
import { MessageListSessionReloadController } from './reloadCurrent'
import { createGuardedSessionMutations, createSessionCommands } from './sessionFacade'
import { createSessionRuntimeEventRouter } from './runtimeEventRouter'
import { applyMessageListInitialWindow } from './initialWindow'
import { loadMessageListEdgeWindow } from './edgeWindow'
import { MessageListSessionSegmentPublisher } from './sessionSegmentPublisher'
import { MessageListSessionDestinationController } from './destinationController'
import { resolveAroundPageAnchor } from './aroundPage'
import { MessageListSessionViewRetention } from './viewRetention'
import { MessageListSessionPreparation } from './sessionPreparation'
import { MessageListSessionRequestRunner } from './sessionRequestRunner'
type OverlayRequestOptions = { overlayRequestId?: number; requestEpoch?: number; trigger?: MessageListRequestTrigger }
type ViewRetentionHandle = ReturnType<MessageListSessionViewRetention['retain']>
export class MessageListSession<Row, Source> implements PublicMessageListSession<Row> {
  readonly #runtime: MessageListRuntime<Row>
  readonly #loadedSegmentStore: LoadedSegmentStore<Row>
  readonly sessionId: MessageListSessionId
  readonly commands: PublicMessageListSession<Row>['commands']
  readonly rows: PublicMessageListSession<Row>['rows']
  readonly tail: PublicMessageListSession<Row>['tail']
  private readonly stateStore: ReturnType<typeof createMessageListSessionState<Row>>
  private readonly context: MessageListSessionContext<Source>
  private readonly readReceipts: MessageListReadReceiptsWorker<Row, Source>
  private readonly overlay: MessageListSessionOverlay
  private readonly bootstrapController: MessageListSessionBootstrapController
  private readonly requestRunner: MessageListSessionRequestRunner<Row, Source>
  private readonly viewRetention = new MessageListSessionViewRetention(
    (retained) => getMessageListSessionRegistryRuntime(this.#runtime).setViewRetained(retained),
    () => this.touch(),
    (active) => { if (active) getMessageListSessionRegistryRuntime(this.#runtime).publishActiveViewObservation() },
  )
  private readonly runtimeUnsubscribe: () => void
  private readonly rowsByKey = new Map<string, Row>()
  private readonly liveSemantics: MessageListSessionLiveSemantics<Row, Source>
  private readonly reloadController: MessageListSessionReloadController<Row, Source>
  private readonly anchorMemoryWriter: MessageListAnchorMemoryWriter<Source> | null
  private readonly lifecycleAbortController = new AbortController()
  private rowsPerViewportEstimate: number
  private visibleKeys: string[] = []
  private measurementSnapshot: RuntimeSegmentSizeSnapshot | null = null
  private readonly preparation: MessageListSessionPreparation<Row, Source>
  private destroyed = false
  private readonly destinationController: MessageListSessionDestinationController
  private readonly segmentPublisher: MessageListSessionSegmentPublisher<Row>
  lastUsedAt = Date.now()
  constructor(private readonly options: SessionOptions<Row, Source>) {
    this.sessionId = options.sessionId
    this.rowsPerViewportEstimate = options.defaults.pageSize
    this.context = { sessionId: options.sessionId, source: options.source }
    this.anchorMemoryWriter = options.adapter.anchorMemory
      ? new MessageListAnchorMemoryWriter(
          this.context, options.adapter.anchorMemory.save,
          (error) => this.reportContractDiagnostic('anchorMemory.saveFailed', 'warn', { error }),
        )
      : null
    this.overlay = new MessageListSessionOverlay(
      () => this.notifyViewListeners(),
      () => {
        this.overlay.bumpRequestEpoch()
        void this.bootstrapController.restart()
      },
    )
    this.requestRunner = new MessageListSessionRequestRunner({
      sessionId: this.sessionId, context: this.context,
      publishSegment: (segment) => this.publishSegment(segment),
      reportEdgeStale: (edge, token) => this.reportEdgeRequestStale(edge, token),
      reportEdgeFailure: (edge, token) => this.#runtime.reportEdgeRequestFailure(edge, token),
      recordResult: (result) => this.preparation.recordRequestResult(result),
      onRequestResult: (result) => this.options.onRequestResult?.(result),
    })
    this.bootstrapController = createMessageListSessionBootstrapController({
      sessionId: this.sessionId,
      context: this.context,
      isDestroyed: () => this.destroyed,
      loadAnchorMemory: () => this.options.adapter.anchorMemory?.load(this.context),
      startOverlayRequest: () => this.overlay.startRequest(),
      getRequestEpoch: () => this.overlay.getRequestEpoch(),
      isStaleOverlayRequest: (overlayRequestId) => this.overlay.isStaleRequest(overlayRequestId),
      isStaleRequestEpoch: (requestEpoch) => this.overlay.isStaleEpoch(requestEpoch),
      ...(this.options.adapter.request.loadInitial
        ? { loadInitial: async (options) => { await this.loadInitial(options) } }
        : {}),
      loadAround: async (target, options) => {
        await this.loadAround(target, undefined, options)
      },
      loadLatest: async (options) => {
        await this.loadLatest(undefined, options)
      },
      finishFailure: (error, overlayRequestId) => {
        this.overlay.finishRequestResult(
          overlayRequestId,
          this.requestRunner.emit({ kind: this.options.adapter.request.loadInitial
            ? 'initial' : 'latest', status: 'failed', trigger: 'internal', error }),
        )
      },
    })
    this.#runtime = createMessageListRuntime<Row>({ sessionId: options.sessionId, scrollMotion: options.scrollMotion })
    getMessageListSessionRegistryRuntime(this.#runtime).setViewRetained(false)
    this.#loadedSegmentStore = createLoadedSegmentStore<Row>({ sessionId: options.sessionId })
    this.destinationController = new MessageListSessionDestinationController(this.sessionId, () => this.destroyed, (state, publishOptions) => this.stateStore.notifyDestinationChanged(state, publishOptions))
    this.reloadController = new MessageListSessionReloadController({
      sessionId: this.sessionId,
      context: this.context,
      adapter: this.options.adapter,
      runtime: getMessageListSessionRegistryRuntime(this.#runtime),
      loadedSegmentStore: this.#loadedSegmentStore,
      getPageSize: () => this.options.defaults.pageSize,
      prepareStagedSegment: (segment, draftStore) => this.segmentPublisher.prepareStaged(segment, draftStore),
      finalizeStagedSegment: (segment) => this.segmentPublisher.finalizeStaged(segment),
      reportDiagnostic: (name, severity, details) => this.reportContractDiagnostic(name, severity, details),
      onRequestResult: (result) => this.options.onRequestResult?.(result),
    })
    this.preparation = new MessageListSessionPreparation({
      sessionId: this.sessionId,
      isDestroyed: () => this.destroyed,
      getSegment: () => this.#loadedSegmentStore.getSegment(),
      hasOverlayError: () =>
        this.overlay.getViewState().overlayStatus.status === 'error',
      runBootstrap: (restart) => restart
        ? this.bootstrapController.restart()
        : this.bootstrapController.ensureStarted(),
      loadAround: (target, prepareOptions) =>
        this.loadAround(target, undefined, prepareOptions),
    })
    this.commands = createSessionCommands({
      isDestroyed: () => this.destroyed,
      prepare: (prepareOptions) => this.preparation.prepare(prepareOptions),
      scrollToLatest: () => {
        this.reloadController.markNavigationChanged()
        this.ensureBootstrapStarted()
        this.#runtime.scrollToLatest()
      },
      scrollToMessage: (target, scrollOptions) => this.destinationController.dispatch(
        target, (normalizedTarget) => {
          this.reloadController.markNavigationChanged()
          this.ensureBootstrapStarted()
          this.#runtime.scrollToMessage(normalizedTarget,
            toRuntimeScrollOptions(this.sessionId, scrollOptions))
        },
      ),
      cancelDestination: (input) =>
        this.destinationController.cancelDestination(input, () => {
          const requestToken = this.#runtime.cancelDestination()
          if (requestToken) {
            this.cancelDestination(requestToken)
          }
          this.reloadController.markNavigationChanged()
        }),
      reloadLatest: ((reloadOptions?: { reason: 'tail-reconcile' }) => {
        if (reloadOptions) {
          this.bootstrapController.markStarted()
          return this.reloadController.reloadLatest(reloadOptions)
        }
        this.reloadController.markNavigationChanged()
        this.bootstrapController.markStarted()
        this.overlay.bumpRequestEpoch()
        void this.loadLatest(undefined, { trigger: 'command' })
      }) as PublicMessageListSession<Row>['commands']['reloadLatest'],
      reloadCurrent: (reloadOptions) => this.reloadController.reloadCurrent(reloadOptions),
      loadBefore: () => {
        this.ensureBootstrapStarted()
        getMessageListSessionRegistryRuntime(this.#runtime).startEdgeRequest('before', 'command-before')
      },
      loadAfter: () => {
        this.ensureBootstrapStarted()
        getMessageListSessionRegistryRuntime(this.#runtime).startEdgeRequest('after', 'command-after')
      },
    })
    this.liveSemantics = new MessageListSessionLiveSemantics({
      sessionId: this.sessionId,
      source: this.options.source,
      adapter: this.options.adapter,
      tailEvents: this.options.tailEvents,
      runtime: getMessageListSessionRegistryRuntime(this.#runtime),
      loadedSegmentStore: this.#loadedSegmentStore,
      publishSegment: (segment) => this.publishSegment(segment),
      publishLocalResetSegment: (segment) => this.publishLocalResetSegment(segment),
      reportDiagnostic: (name, severity, details) => this.reportContractDiagnostic(name, severity, details),
    })
    const sessionRows = createSessionRows({
      sessionId: this.sessionId,
      adapter: this.options.adapter,
      loadedSegmentStore: this.#loadedSegmentStore,
      publishSegment: (segment) => this.publishSegment(segment),
      publishLocalResetSegment: (segment) => this.publishLocalResetSegment(segment),
      clearPendingLocal: () => this.liveSemantics.clearPendingLocal(),
      getVisibleKeys: () => this.visibleKeys,
      probeInvalidateAfterSafety: (input) => getMessageListSessionRegistryRuntime(this.#runtime).probeInvalidateAfterSafety(input),
      reportDiagnostic: (name, severity, details) => this.reportContractDiagnostic(name, severity, details),
    })
    const guarded = createGuardedSessionMutations({
      isDestroyed: () => this.destroyed,
      rows: sessionRows,
      tail: this.liveSemantics.tail,
      reloadController: this.reloadController,
    })
    this.rows = guarded.rows
    this.tail = guarded.tail
    this.stateStore = createMessageListSessionState({
      sessionId: this.sessionId,
      runtime: this.#runtime,
      getCommittedSegment: () => this.segmentPublisher.getCommittedSegment(),
      getViewState: () => this.getViewState(),
      getDestinationState: () => this.destinationController.getState(),
    })
    this.readReceipts = new MessageListReadReceiptsWorker(options.adapter, (keys) => this.getRowsByKeys(keys))
    this.segmentPublisher = new MessageListSessionSegmentPublisher({
      initialSegment: this.#loadedSegmentStore.getSegment(),
      runtime: this.#runtime,
      loadedSegmentStore: this.#loadedSegmentStore,
      defaults: this.options.defaults,
      rowsByKey: this.rowsByKey,
      getRowsPerViewportEstimate: () => this.rowsPerViewportEstimate,
      settlePendingLocalForSegment: (segment) => this.liveSemantics.settlePendingLocalForSegment(segment),
      notifyLoadedChanged: () => this.stateStore.notifyLoadedChanged(),
    })
    const routeRuntimeEvent = createSessionRuntimeEventRouter({
      isCurrent: (generation, revision) => this.isStaleSegment(generation, revision) === false,
      onNavigation: () => this.reloadController.markNavigationChanged(),
      onDestinationCancelled: (requestToken) => this.cancelDestination(requestToken),
      saveAnchor: (value) => { if (this.viewRetention.hasActiveView()) this.anchorMemoryWriter?.enqueue(value) },
      onObservation: (event) => this.handleViewportObservation(event),
      loadEdge: (event) => { void this.loadEdge(event) },
      loadLatest: (event) => { void this.loadLatest(event) },
      loadAround: (target, event) => { void this.loadAround(target, event) },
    })
    defineMessageListSessionInternals<Row>(this, {
      runtime: this.#runtime,
      loadedSegmentStore: this.#loadedSegmentStore,
      getSnapshot: () => this.getSnapshot(),
      getViewState: () => this.getViewState(),
      subscribeView: (listener) => this.subscribeView(listener),
      retainView: (presentation) => this.retainView(presentation),
      getRow: (item) => this.getRow(item),
      getRowRenderVersion: (item) => this.getRowRenderVersion(item),
      getRowsByKeys: (keys) => this.getRowsByKeys(keys),
      getMeasurementSnapshot: () => this.measurementSnapshot,
    })
    this.runtimeUnsubscribe = this.#runtime.subscribeRuntimeEvent((event) => {
      this.options.onRuntimeEvent?.(toSessionRuntimeLogEvent(event))
      if (this.destroyed) return
      this.destinationController.handleRuntimeEvent(event)
      this.reloadController.handleRuntimeEvent(event)
      if (event.type === 'projectionSettled') this.overlay.finishProjection(event)
      this.touch()
      routeRuntimeEvent(event)
    })
  }
  getSnapshot(): MessageListSnapshot<Row> { return this.#runtime.getSnapshot() }
  getViewState(): MessageListViewState { return this.overlay.getViewState() }
  getState(): MessageListSessionState<Row> { return this.stateStore.getState() }
  subscribe(listener: () => void): () => void { return this.stateStore.subscribe(listener) }
  subscribeView(listener: () => void): () => void { return this.viewRetention.subscribe(listener) }
  retainView(presentation: 'staging' | 'active' = 'active'): ViewRetentionHandle { this.touch(); this.ensureBootstrapStarted(); return this.viewRetention.retain(presentation) }
  hasRetainedView(): boolean { return this.viewRetention.hasRetainedView() }
  getViewRetainCount(): number { return this.viewRetention.getRetainCount() }
  getRow(item: MessageDataItem<Row>): Row | null { return item.message ?? null }
  getRowRenderVersion(item: MessageDataItem<Row>): unknown {
    const row = this.getRow(item)
    return row ? this.options.adapter.row.getVersion?.(row) : item.renderVersion
  }
  getRowsByKeys(keys: string[]): Row[] {
    const rows: Row[] = []
    for (const key of keys) {
      const row = this.rowsByKey.get(key)
      if (row !== undefined) {
        rows.push(row)
      }
    }
    return rows
  }
  destroy(): void {
    if (this.destroyed) return
    // 先关闭命令受理，再向 subscriber 发布 cancellation。
    this.destroyed = true
    this.destinationController.destroy()
    this.lifecycleAbortController.abort()
    this.reloadController.destroy()
    this.anchorMemoryWriter?.destroy()
    this.overlay.destroy()
    this.runtimeUnsubscribe()
    this.readReceipts.destroy()
    this.stateStore.destroy()
    this.#runtime.destroy()
    this.visibleKeys = []
    this.measurementSnapshot = null
    this.viewRetention.destroy()
  }
  ensureBootstrapStarted(): void { void this.bootstrapController.ensureStarted() }
  private cancelDestination(requestToken: string): void {
    this.#loadedSegmentStore.cancelRequestToken(requestToken)
    this.overlay.bumpRequestEpoch()
    this.overlay.cancelRequest()
    this.reloadController.markNavigationChanged()
  }
  private handleViewportObservation(
    event: Extract<MessageListRuntimeEvent, { type: 'viewportObservationChanged' }>,
  ): void {
    this.visibleKeys = event.visibleKeys
    if (event.visibleItems.length > 0) this.rowsPerViewportEstimate = event.visibleItems.length
    this.measurementSnapshot = getMessageListSessionRegistryRuntime(this.#runtime).getSegmentSizeSnapshot()
    if (this.viewRetention.hasActiveView()) this.readReceipts.handleObservation(event)
  }
  private async loadLatest(
    event?: RuntimeNeedEvent,
    options: OverlayRequestOptions = {},
  ): Promise<MessageListRequestResult<Row, Source>> {
    const overlayRequestId = options.overlayRequestId ?? this.overlay.startRequest()
    const requestEpoch = options.requestEpoch ?? this.overlay.getRequestEpoch()
    const requestSegment = this.#loadedSegmentStore.getSegment()
    const requestGeneration = requestSegment.generation
    const requestSegmentRevision = requestSegment.segmentRevision
    if (event) {
      this.adoptRequestToken(event, 'latest')
    }
    const trigger = this.resolveRequestTrigger('latest', event, options.trigger)
    const result = await this.requestRunner.run('latest', event, trigger, async () => {
      const page = await this.options.adapter.request.loadLatest({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event?.requestToken,
        trigger,
        reason: event?.reason,
        signal: this.lifecycleAbortController.signal,
      })
      if (this.overlay.isStaleRequest(overlayRequestId) ||
        this.overlay.isStaleEpoch(requestEpoch)) {
        return {
          page,
          segment: this.#loadedSegmentStore.getSegment(),
          applied: false,
        }
      }
      if (this.isStaleResetRequest(event, requestGeneration, requestSegmentRevision)) {
        return {
          page,
          segment: this.#loadedSegmentStore.getSegment(),
          applied: false,
        }
      }
      assertLatestPageContract(page, (name, severity, details) =>
        this.reportContractDiagnostic(name, severity, details), {
        requestKind: 'latest',
        trigger,
      })
      const local = this.liveSemantics.withPendingLocal(page)
      const applied = event
        ? this.#loadedSegmentStore.resetLatestFromRequest({
            ...local.resetInput,
            requestToken: event.requestToken,
          })
        : {
            applied: true,
            segment: this.#loadedSegmentStore.resetLatest(
              local.resetInput,
            ),
          }
      return { page: local.page, segment: applied.segment, applied: applied.applied }
    })
    this.overlay.finishRequestResult(overlayRequestId, result, true, result.status === 'applied' ? this.#loadedSegmentStore.getSegment() : undefined)
    return result
  }
  private async loadInitial(
    options: OverlayRequestOptions = {},
  ): Promise<MessageListRequestResult<Row, Source>> {
    const loadInitial = this.options.adapter.request.loadInitial
    if (!loadInitial) {
      return this.loadLatest(undefined, options)
    }
    const overlayRequestId = options.overlayRequestId ?? this.overlay.startRequest()
    const requestEpoch = options.requestEpoch ?? this.overlay.getRequestEpoch()
    const requestSegment = this.#loadedSegmentStore.getSegment()
    const trigger = this.resolveRequestTrigger('initial', undefined, options.trigger)
    const result = await this.requestRunner.run('initial', undefined, trigger, async () => {
      const initial = await loadInitial({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        trigger,
        signal: this.lifecycleAbortController.signal,
      })
      if (
        this.overlay.isStaleRequest(overlayRequestId) ||
        this.overlay.isStaleEpoch(requestEpoch) ||
        this.isStaleSegment(requestSegment.generation, requestSegment.segmentRevision)
      ) {
        return {
          page: initial.page,
          segment: this.#loadedSegmentStore.getSegment(),
          applied: false,
        }
      }
      const applied = applyMessageListInitialWindow({
        sessionId: this.sessionId,
        initial,
        adapter: this.options.adapter,
        loadedSegmentStore: this.#loadedSegmentStore,
        withPendingLocal: (page) => this.liveSemantics.withPendingLocal(page),
        report: (name, severity, details) =>
          this.reportContractDiagnostic(name, severity, details),
        trigger,
      })
      return { ...applied, applied: true }
    })
    this.overlay.finishRequestResult(overlayRequestId, result, true, result.status === 'applied' ? this.#loadedSegmentStore.getSegment() : undefined)
    return result
  }
  private async loadAround(
    target: MessageIdentityAnchor,
    event?: RuntimeNeedEvent,
    options: AroundRequestOptions & OverlayRequestOptions = {},
  ): Promise<MessageListRequestResult<Row, Source>> {
    const overlayRequestId = options.overlayRequestId ?? this.overlay.startRequest()
    const requestEpoch = options.requestEpoch ?? this.overlay.getRequestEpoch()
    const requestSegment = this.#loadedSegmentStore.getSegment()
    const requestGeneration = requestSegment.generation
    const requestSegmentRevision = requestSegment.segmentRevision
    if (event) {
      this.adoptRequestToken(event, 'around')
    }
    const trigger = this.resolveRequestTrigger('around', event, options.trigger)
    const context = options.context ?? 'around'
    const result = await this.requestRunner.run('around', event, trigger, async () => {
      const page = await this.options.adapter.request.loadAround({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event?.requestToken,
        trigger,
        reason: event?.reason,
        target,
        signal: this.lifecycleAbortController.signal,
      })
      if (this.overlay.isStaleRequest(overlayRequestId) ||
        this.overlay.isStaleEpoch(requestEpoch)) {
        return {
          page,
          segment: this.#loadedSegmentStore.getSegment(),
          applied: false,
        }
      }
      if (this.isStaleResetRequest(event, requestGeneration, requestSegmentRevision)) {
        return {
          page,
          segment: this.#loadedSegmentStore.getSegment(),
          applied: false,
        }
      }
      assertReachedLatestContract(page, (name, severity, details) =>
        this.reportContractDiagnostic(name, severity, details), {
          requestKind: 'around',
          trigger,
          context,
        })
      if (page.reachedLatest && context === 'around') {
        this.reportContractDiagnostic('aroundReachedLatestIgnored', 'warn', {
          requestKind: 'around',
          trigger,
        })
      }
      const resetInput = toSessionResetInput(this.sessionId, page, this.options.adapter)
      assertAroundPageTargetContract({
        page,
        target,
        items: resetInput.items,
        report: (name, severity, details) =>
          this.reportContractDiagnostic(name, severity, details),
      })
      const resolvedAnchor = resolveAroundPageAnchor(page, resetInput.items, resetInput.anchor)
      const applied = event
        ? this.#loadedSegmentStore.resetAroundFromRequest({
            ...resetInput,
            anchor: resolvedAnchor,
            target,
            requestToken: event.requestToken,
            context,
            align: options.align,
            offsetWithinMessage: options.offsetWithinMessage,
          })
        : {
            applied: true,
            segment: this.#loadedSegmentStore.resetAround({
              ...resetInput,
              anchor: resolvedAnchor,
              target,
              context,
              align: options.align,
              offsetWithinMessage: options.offsetWithinMessage,
            }),
          }
      if (event && applied.applied) this.destinationController.expectProjection(event.requestToken, applied.segment)
      return { page, segment: applied.segment, applied: applied.applied }
    })
    if (event) this.destinationController.finishRequest(event.requestToken, result)
    this.overlay.finishRequestResult(overlayRequestId, result, !event, result.status === 'applied' ? this.#loadedSegmentStore.getSegment() : undefined)
    return result
  }
  private async loadEdge(event: RuntimeNeedEvent): Promise<void> {
    const edge = event.type === 'needMoreBefore' ? 'before' : 'after'
    const trigger = this.resolveRequestTrigger(edge, event)
    if (this.isStaleEvent(event)) { this.reportEdgeRequestStale(edge, event.requestToken); this.requestRunner.emit({ kind: edge, status: 'stale', trigger }); return }
    const segment = this.#loadedSegmentStore.getSegment()
    const boundaryItem = edge === 'before' ? segment.items[0] : segment.items.at(-1)
    const boundaryRow = boundaryItem?.message
    if (!boundaryRow) {
      this.#runtime.reportEdgeRequestFailure(edge, event.requestToken)
      return
    }
    this.adoptRequestToken(event, edge)
    await this.requestRunner.run(edge, event, trigger, () =>
      loadMessageListEdgeWindow({
        adapter: this.options.adapter, boundaryRow, context: this.context,
        edge, event, isStale: () => this.isStaleEvent(event),
        loadedSegmentStore: this.#loadedSegmentStore,
        pageSize: this.options.defaults.pageSize,
        report: (name, severity, details) => this.reportContractDiagnostic(name, severity, details),
        runtime: getMessageListSessionRegistryRuntime(this.#runtime),
        sessionId: this.sessionId, signal: this.lifecycleAbortController.signal,
        trigger,
      }))
  }
  private publishSegment(segment: LoadedSegment<Row>): void {
    this.reloadController.cancelSettlingProjectionForAuthoritativePublish()
    if (this.segmentPublisher.publish(segment)) {
      this.reloadController.markTopologyChanged()
    }
  }
  private publishLocalResetSegment(segment: LoadedSegment<Row>): void {
    this.overlay.bumpRequestEpoch()
    this.overlay.cancelRequest()
    this.publishSegment(segment)
  }
  private adoptRequestToken(
    event: RuntimeNeedEvent,
    kind: LoadedSegmentRequestKind,
  ): void {
    this.#loadedSegmentStore.adoptRequestToken({
      requestToken: event.requestToken,
      generation: event.generation,
      segmentRevision: event.segmentRevision,
      kind,
    })
  }
  private reportContractDiagnostic(
    name: string,
    severity: 'debug' | 'info' | 'warn' | 'error',
    details: Record<string, unknown> = {},
  ): void {
    const runtime = getMessageListSessionRegistryRuntime(this.#runtime)
    reportContractDiagnostic(
      (diagnosticName, diagnosticSeverity, diagnosticDetails) =>
        runtime.reportSessionDiagnostic(
          diagnosticName,
          diagnosticSeverity,
          diagnosticDetails,
        ),
      name,
      severity,
      details,
    )
  }
  private resolveRequestTrigger(
    kind: 'initial' | 'latest' | 'before' | 'after' | 'around',
    event?: RuntimeNeedEvent,
    override?: MessageListRequestTrigger,
  ): MessageListRequestTrigger {
    const trigger = override ?? resolveRequestTriggerFromEvent(event)
    if (trigger === 'viewport' && kind !== 'before' && kind !== 'after') {
      this.reportContractDiagnostic('requestTrigger.invalidViewportUse', 'warn', {
        requestKind: kind,
        eventType: event?.type,
        reason: event?.reason,
      })
      return 'internal'
    }
    return trigger
  }
  private reportEdgeRequestStale(edge: 'before' | 'after', requestToken: string): void { getMessageListSessionRegistryRuntime(this.#runtime).reportEdgeRequestStale(edge, requestToken) }
  private isStaleEvent(event: RuntimeNeedEvent | undefined): boolean { if (!event) return false; return this.#loadedSegmentStore.getSegment().generation !== event.generation }
  private isStaleResetRequest(event: RuntimeNeedEvent | undefined, requestGeneration: number, requestSegmentRevision: number): boolean { return event ? this.#loadedSegmentStore.getSegment().generation !== event.generation : this.isStaleSegment(requestGeneration, requestSegmentRevision) }
  private isStaleSegment(generation: number, segmentRevision: number): boolean { const segment = this.#loadedSegmentStore.getSegment(); return segment.generation !== generation || segment.segmentRevision !== segmentRevision }
  private notifyViewListeners(): void { this.stateStore.notifyViewChanged(); this.viewRetention.notify() }
  private touch(): void { this.lastUsedAt = Date.now() }
}
