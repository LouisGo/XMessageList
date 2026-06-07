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
import { normalizeMessageListAnchor } from '../adapters/rowAdapter'
import { MessageListSessionLiveSemantics } from '../tail/tailSemantics'
import { assertLatestPageContract, assertReachedLatestContract, reportContractDiagnostic } from './contractDiagnostics'
import { reindexRows, resolveAdaptiveTrimBudget, resolveExtendedContext, resolveRequestTriggerFromEvent, resolveTrimProtectKey, toRuntimeScrollOptions, toSessionResetInput, type AroundRequestOptions, type RuntimeNeedEvent, type SessionOptions } from './helpers'
import type { MessageListPage, MessageListRequestTrigger, MessageListRequestResult, MessageListSessionId, MessageListSession as PublicMessageListSession, MessageListSessionContext, MessageListSessionState, MessageListViewState } from '../contracts'
type OverlayRequestOptions = { overlayRequestId?: number; requestEpoch?: number; trigger?: MessageListRequestTrigger }
type RequestResultInput<Row, Source> = Omit<MessageListRequestResult<Row, Source>, 'sessionId' | 'source'>
export class MessageListSession<Row, Source>
  implements PublicMessageListSession<Row> {
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
  private readonly viewListeners = new Set<() => void>()
  private readonly runtimeUnsubscribe: () => void
  private readonly rowsByKey = new Map<string, Row>()
  private readonly liveSemantics: MessageListSessionLiveSemantics<Row, Source>
  private viewRetainCount = 0
  private rowsPerViewportEstimate: number
  private measurementSnapshot: RuntimeSegmentSizeSnapshot | null = null
  private destroyed = false
  lastUsedAt = Date.now()
  constructor(private readonly options: SessionOptions<Row, Source>) {
    this.sessionId = options.sessionId
    this.rowsPerViewportEstimate = options.defaults.pageSize
    this.context = { sessionId: options.sessionId, source: options.source }
    this.overlay = new MessageListSessionOverlay(
      () => this.notifyViewListeners(),
      () => {
        this.overlay.bumpRequestEpoch()
        this.bootstrapController.restart()
      },
    )
    this.bootstrapController = createMessageListSessionBootstrapController({
      sessionId: this.sessionId,
      context: this.context,
      isDestroyed: () => this.destroyed,
      loadAnchorMemory: () => this.options.adapter.anchorMemory?.load(this.context),
      startOverlayRequest: () => this.overlay.startRequest(),
      getRequestEpoch: () => this.overlay.getRequestEpoch(),
      isStaleOverlayRequest: (overlayRequestId) =>
        this.overlay.isStaleRequest(overlayRequestId),
      isStaleRequestEpoch: (requestEpoch) =>
        this.overlay.isStaleEpoch(requestEpoch),
      loadAround: (target, options) => this.loadAround(target, undefined, options),
      loadLatest: (options) => this.loadLatest(undefined, options),
      finishFailure: (error, overlayRequestId) => {
        this.finishOverlayRequest(
          this.emitRequestResult({
            kind: 'latest',
            status: 'failed',
            trigger: 'internal',
            error,
          }),
          overlayRequestId,
        )
      },
    })
    this.#runtime = createMessageListRuntime<Row>({
      sessionId: options.sessionId,
      scrollMotion: options.scrollMotion,
    })
    this.#loadedSegmentStore = createLoadedSegmentStore<Row>({ sessionId: options.sessionId })
    this.commands = {
      scrollToLatest: () => {
        if (this.destroyed) return
        this.ensureBootstrapStarted()
        this.#runtime.scrollToLatest()
      },
      scrollToMessage: (target, scrollOptions) => {
        if (this.destroyed) return
        this.ensureBootstrapStarted()
        this.#runtime.scrollToMessage(
          normalizeMessageListAnchor(this.sessionId, target),
          toRuntimeScrollOptions(this.sessionId, scrollOptions),
        )
      },
      reloadLatest: () => {
        if (this.destroyed) return
        this.bootstrapController.markStarted()
        this.overlay.bumpRequestEpoch()
        void this.loadLatest(undefined, { trigger: 'command' })
      },
      loadBefore: () => {
        if (this.destroyed) return
        this.ensureBootstrapStarted()
        getMessageListSessionRegistryRuntime(this.#runtime)
          .startEdgeRequest('before', 'command-before')
      },
      loadAfter: () => {
        if (this.destroyed) return
        this.ensureBootstrapStarted()
        getMessageListSessionRegistryRuntime(this.#runtime)
          .startEdgeRequest('after', 'command-after')
      },
    }
    this.liveSemantics = new MessageListSessionLiveSemantics({
      sessionId: this.sessionId,
      source: this.options.source,
      adapter: this.options.adapter,
      tailEvents: this.options.tailEvents,
      runtime: getMessageListSessionRegistryRuntime(this.#runtime),
      loadedSegmentStore: this.#loadedSegmentStore,
      publishSegment: (segment) => this.publishSegment(segment),
      publishLocalResetSegment: (segment) => this.publishLocalResetSegment(segment),
      reportDiagnostic: (name, severity, details) =>
        this.reportContractDiagnostic(name, severity, details),
    })
    this.rows = createSessionRows({
      sessionId: this.sessionId,
      adapter: this.options.adapter,
      loadedSegmentStore: this.#loadedSegmentStore,
      publishSegment: (segment) => this.publishSegment(segment),
      publishLocalResetSegment: (segment) => this.publishLocalResetSegment(segment),
      clearPendingLocal: () => this.liveSemantics.clearPendingLocal(),
      reportDiagnostic: (name, severity, details) =>
        this.reportContractDiagnostic(name, severity, details),
    })
    this.tail = this.liveSemantics.tail
    this.stateStore = createMessageListSessionState({
      sessionId: this.sessionId,
      runtime: this.#runtime,
      getViewState: () => this.getViewState(),
    })
    this.readReceipts = new MessageListReadReceiptsWorker(
      options.adapter,
      (keys) => this.getRowsByKeys(keys),
    )
    defineMessageListSessionInternals<Row>(this, {
      runtime: this.#runtime,
      loadedSegmentStore: this.#loadedSegmentStore,
      getSnapshot: () => this.getSnapshot(),
      getViewState: () => this.getViewState(),
      subscribeView: (listener) => this.subscribeView(listener),
      retainView: () => this.retainView(),
      getRow: (item) => this.getRow(item),
      getRowRenderVersion: (item) => this.getRowRenderVersion(item),
      getRowsByKeys: (keys) => this.getRowsByKeys(keys),
      getMeasurementSnapshot: () => this.measurementSnapshot,
    })
    this.runtimeUnsubscribe = this.#runtime.subscribeRuntimeEvent((event) => {
      this.options.onRuntimeEvent?.(toSessionRuntimeLogEvent(event))
      this.handleRuntimeEvent(event)
    })
  }
  getSnapshot(): MessageListSnapshot<Row> { return this.#runtime.getSnapshot() }
  getViewState(): MessageListViewState { return this.overlay.getViewState() }
  getState(): MessageListSessionState<Row> { return this.stateStore.getState() }
  subscribe(listener: () => void): () => void { return this.stateStore.subscribe(listener) }
  subscribeView(listener: () => void): () => void {
    this.viewListeners.add(listener)
    return () => this.viewListeners.delete(listener)
  }
  retainView(): () => void {
    this.viewRetainCount += 1
    this.touch()
    this.ensureBootstrapStarted()
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.viewRetainCount = Math.max(0, this.viewRetainCount - 1)
      this.touch()
    }
  }
  hasRetainedView(): boolean { return this.viewRetainCount > 0 }
  getViewRetainCount(): number { return this.viewRetainCount }
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
    this.destroyed = true
    this.overlay.destroy()
    this.runtimeUnsubscribe()
    this.readReceipts.destroy()
    this.stateStore.destroy()
    this.#runtime.destroy()
    this.measurementSnapshot = null
    this.viewListeners.clear()
  }
  ensureBootstrapStarted(): void { this.bootstrapController.ensureStarted() }
  private handleRuntimeEvent(event: MessageListRuntimeEvent): void {
    this.touch()
    if (event.type === 'viewportAnchorChanged' && event.anchor) {
      const snapshot = this.#runtime.getSnapshot()
      if (
        snapshot.generation !== event.generation ||
        snapshot.segmentRevision !== event.segmentRevision
      ) {
        return
      }
      void this.options.adapter.anchorMemory?.save(
        this.context,
        {
          anchor: event.anchor,
          offsetWithinMessage: event.offsetWithinMessage,
        },
      )
      return
    }
    if (event.type === 'viewportObservationChanged') {
      if (event.visibleItems.length > 0) this.rowsPerViewportEstimate = event.visibleItems.length
      this.measurementSnapshot = getMessageListSessionRegistryRuntime(this.#runtime).getSegmentSizeSnapshot()
      this.readReceipts.handleObservation(event)
      return
    }
    if (event.type === 'needMoreBefore' || event.type === 'needMoreAfter') {
      void this.loadEdge(event)
      return
    }
    if (event.type === 'needLatestMessages') {
      void this.loadLatest(event)
      return
    }
    if (event.type === 'needMessagesAround') {
      void this.loadAround(event.target, event)
    }
  }
  private async loadLatest(
    event?: RuntimeNeedEvent,
    options: OverlayRequestOptions = {},
  ): Promise<void> {
    const overlayRequestId = options.overlayRequestId ?? this.overlay.startRequest()
    const requestEpoch = options.requestEpoch ?? this.overlay.getRequestEpoch()
    const requestSegment = this.#loadedSegmentStore.getSegment()
    const requestGeneration = requestSegment.generation
    const requestSegmentRevision = requestSegment.segmentRevision
    if (event) {
      this.adoptRequestToken(event, 'latest')
    }
    const trigger = this.resolveRequestTrigger('latest', event, options.trigger)
    const result = await this.runRequest('latest', event, trigger, async () => {
      const page = await this.options.adapter.request.loadLatest({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event?.requestToken,
        trigger,
        reason: event?.reason,
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
    this.finishOverlayRequest(result, overlayRequestId)
  }
  private async loadAround(
    target: MessageIdentityAnchor,
    event?: RuntimeNeedEvent,
    options: AroundRequestOptions & OverlayRequestOptions = {},
  ): Promise<void> {
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
    const result = await this.runRequest('around', event, trigger, async () => {
      const page = await this.options.adapter.request.loadAround({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event?.requestToken,
        trigger,
        reason: event?.reason,
        target,
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
      const applied = event
        ? this.#loadedSegmentStore.resetAroundFromRequest({
            ...toSessionResetInput(this.sessionId, page, this.options.adapter),
            target,
            requestToken: event.requestToken,
            context,
            align: options.align,
            offsetWithinMessage: options.offsetWithinMessage,
          })
        : {
            applied: true,
            segment: this.#loadedSegmentStore.resetAround({
              ...toSessionResetInput(this.sessionId, page, this.options.adapter),
              target,
              context,
              align: options.align,
              offsetWithinMessage: options.offsetWithinMessage,
            }),
          }
      return { page, segment: applied.segment, applied: applied.applied }
    })
    this.finishOverlayRequest(result, overlayRequestId)
  }
  private async loadEdge(event: RuntimeNeedEvent): Promise<void> {
    const edge = event.type === 'needMoreBefore' ? 'before' : 'after'
    const trigger = this.resolveRequestTrigger(edge, event)
    if (this.isStaleEvent(event)) { this.reportEdgeRequestStale(edge, event.requestToken); this.emitRequestResult({ kind: edge, status: 'stale', trigger }); return }
    const segment = this.#loadedSegmentStore.getSegment()
    const boundaryItem = edge === 'before' ? segment.items[0] : segment.items.at(-1)
    const boundaryRow = boundaryItem?.message
    if (!boundaryRow) {
      this.#runtime.reportEdgeRequestFailure(edge, event.requestToken)
      return
    }
    this.adoptRequestToken(event, edge)
    await this.runRequest(edge, event, trigger, async () => {
      const page = await (
        edge === 'before'
          ? this.options.adapter.request.loadBefore
          : this.options.adapter.request.loadAfter
      )({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event.requestToken,
        trigger,
        reason: event.reason,
        boundaryRow,
      })
      if (this.isStaleEvent(event)) {
        return {
          page,
          segment: this.#loadedSegmentStore.getSegment(),
          applied: false,
        }
      }
      const currentSegment = this.#loadedSegmentStore.getSegment()
      assertReachedLatestContract(page, (name, severity, details) =>
        this.reportContractDiagnostic(name, severity, details), {
          requestKind: edge,
          trigger,
          context: currentSegment.context,
        })
      if (edge === 'after' && page.reachedLatest && currentSegment.context === 'around') {
        this.reportContractDiagnostic('aroundReachedLatestIgnored', 'warn', {
          requestKind: edge,
          trigger,
        })
      }
      const nextContext = resolveExtendedContext({
        edge,
        currentContext: currentSegment.context,
        reachedLatest: page.reachedLatest,
      })
      if (
        edge === 'after' &&
        currentSegment.context === 'history' &&
        nextContext === 'latest' &&
        trigger === 'viewport'
      ) {
        getMessageListSessionRegistryRuntime(this.#runtime)
          .prepareFollowBottomForLocalReset()
      }
      const input = {
        ...toSessionResetInput(this.sessionId, page, this.options.adapter),
        hasMoreBefore: edge === 'before'
          ? page.hasMoreBefore
          : currentSegment.hasMoreBefore,
        hasMoreAfter: edge === 'after'
          ? page.hasMoreAfter
          : currentSegment.hasMoreAfter,
        context: nextContext,
        requestToken: event.requestToken,
        anchor: currentSegment.anchor,
        anchorStatus: currentSegment.anchorStatus,
      }
      const applied = edge === 'before'
        ? this.#loadedSegmentStore.extendBefore(input)
        : this.#loadedSegmentStore.extendAfter(input)
      return { page, segment: applied.segment, applied: applied.applied }
    })
  }
  private async runRequest(
    kind: 'latest' | 'before' | 'after' | 'around',
    event: RuntimeNeedEvent | undefined,
    trigger: MessageListRequestTrigger,
    request: () => Promise<{
      page: MessageListPage<Row>
      segment: LoadedSegment<Row>
      applied: boolean
    }>,
  ): Promise<MessageListRequestResult<Row, Source>> {
    try {
      const result = await request()
      if (!result.applied) {
        if (kind === 'before' || kind === 'after') {
          this.reportEdgeRequestStale(kind, event?.requestToken ?? '')
        }
        return this.emitRequestResult({ kind, status: 'stale', trigger })
      }
      this.publishSegment(result.segment)
      return this.emitRequestResult({
        kind,
        status: 'applied',
        trigger,
        page: result.page,
      })
    } catch (error) {
      if (kind === 'before' || kind === 'after') {
        this.#runtime.reportEdgeRequestFailure(kind, event?.requestToken ?? '')
      }
      return this.emitRequestResult({ kind, status: 'failed', trigger, error })
    }
  }
  private publishSegment(segment: LoadedSegment<Row>): void {
    let current = segment
    this.applySegmentToRuntime(current)
    const budget = resolveAdaptiveTrimBudget({ pageSize: this.options.defaults.pageSize, retention: this.options.defaults.retention, rowsPerViewportEstimate: this.rowsPerViewportEstimate })
    const maxTrimPasses = Math.max(1, current.items.length)
    for (let guard = 0; guard < maxTrimPasses; guard += 1) {
      if (current.items.length <= budget) return
      const previousLength = current.items.length
      const trimmed = this.#loadedSegmentStore.trimToBudget(budget, resolveTrimProtectKey(this.#runtime, this.#loadedSegmentStore))
      if (trimmed === current || trimmed.items.length >= previousLength) return
      current = trimmed
      this.applySegmentToRuntime(current)
    }
  }
  private applySegmentToRuntime(segment: LoadedSegment<Row>): void {
    this.liveSemantics.settlePendingLocalForSegment(segment)
    reindexRows(this.rowsByKey, segment.items)
    this.#runtime.applyLoadedSegment(segment)
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
    kind: 'latest' | 'before' | 'after' | 'around',
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
  private isStaleEvent(event: RuntimeNeedEvent | undefined): boolean { if (!event) return false; const segment = this.#loadedSegmentStore.getSegment(); return segment.generation !== event.generation || segment.segmentRevision !== event.segmentRevision }
  private isStaleResetRequest(event: RuntimeNeedEvent | undefined, requestGeneration: number, requestSegmentRevision: number): boolean { return event ? this.#loadedSegmentStore.getSegment().generation !== event.generation : this.isStaleSegment(requestGeneration, requestSegmentRevision) }
  private isStaleSegment(generation: number, segmentRevision: number): boolean { const segment = this.#loadedSegmentStore.getSegment(); return segment.generation !== generation || segment.segmentRevision !== segmentRevision }
  private emitRequestResult(result: RequestResultInput<Row, Source>): MessageListRequestResult<Row, Source> { const next = { sessionId: this.sessionId, source: this.options.source, ...result }; this.options.onRequestResult?.(next); return next }
  private finishOverlayRequest(result: MessageListRequestResult<Row, Source>, overlayRequestId: number): void { this.overlay.finishRequest(overlayRequestId, result.status === 'failed' ? 'error' : 'idle', result.error) }
  private notifyViewListeners(): void { this.stateStore.notifyViewChanged(); for (const listener of this.viewListeners) listener() }
  private touch(): void { this.lastUsedAt = Date.now() }
}
