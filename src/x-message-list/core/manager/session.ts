import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type MessageIdentityAnchor,
  type MessageListRuntime,
  type MessageListRuntimeEvent,
  type MessageListSnapshot,
} from '../runtime/index'
import {
  createMessageListDataRuntime,
  type DataRuntimeRequestKind,
  type MessageListDataRuntime,
} from '../runtime/data/index'
import { getMessageListManagerRuntime } from '../runtime/internal'
import { MessageListReadReceiptsWorker } from './readReceipts'
import { MessageListSessionOverlay } from './sessionOverlay'
import { createMessageListSessionState } from './sessionState'
import { createSessionRows } from './sessionRows'
import { defineMessageListSessionInternals } from './internal'
import { normalizeMessageListAnchor } from './rowAdapter'
import { MessageListSessionLiveSemantics } from './sessionLiveSemantics'
import {
  reindexRows,
  resolveTrimProtectKey,
  toRuntimeScrollOptions,
  toSessionResetInput,
  type AroundRequestOptions,
  type RuntimeNeedEvent,
  type SessionOptions,
} from './sessionHelpers'
import type {
  MessageListConversationId,
  MessageListPage,
  MessageListRequestResult,
  MessageListSession as PublicMessageListSession,
  MessageListSessionContext,
  MessageListSessionState,
  MessageListViewState,
} from './types'

type OverlayRequestOptions = { overlayRequestId?: number; requestEpoch?: number }

export class MessageListSession<Row, Conversation>
  implements PublicMessageListSession<Row> {
  readonly #runtime: MessageListRuntime<Row>
  readonly #dataRuntime: MessageListDataRuntime<Row>
  readonly id: MessageListConversationId
  readonly commands: PublicMessageListSession<Row>['commands']
  readonly rows: PublicMessageListSession<Row>['rows']
  readonly outgoing: PublicMessageListSession<Row>['outgoing']
  readonly incoming: PublicMessageListSession<Row>['incoming']
  private readonly stateStore: ReturnType<typeof createMessageListSessionState<Row>>
  private readonly context: MessageListSessionContext<Conversation>
  private readonly readReceipts: MessageListReadReceiptsWorker<Row, Conversation>
  private readonly overlay: MessageListSessionOverlay
  private readonly viewListeners = new Set<() => void>()
  private readonly runtimeUnsubscribe: () => void
  private readonly rowsByKey = new Map<string, Row>()
  private readonly liveSemantics: MessageListSessionLiveSemantics<Row, Conversation>
  private viewRetainCount = 0
  lastUsedAt = Date.now()

  constructor(private readonly options: SessionOptions<Row, Conversation>) {
    this.id = options.id
    this.context = {
      id: options.id,
      conversation: options.conversation,
    }
    this.overlay = new MessageListSessionOverlay(
      () => this.notifyViewListeners(),
      () => {
        this.overlay.bumpRequestEpoch()
        void this.bootstrap()
      },
    )
    this.#runtime = createMessageListRuntime<Row>({
      feedId: options.id,
      scrollMotion: options.scrollMotion,
    })
    this.#dataRuntime = createMessageListDataRuntime<Row>({
      feedId: options.id,
      itemBudget: options.defaults.maxItems,
    })
    this.commands = {
      scrollToLatest: () => this.#runtime.scrollToLatest(),
      scrollToMessage: (target, scrollOptions) =>
        this.#runtime.scrollToMessage(
          normalizeMessageListAnchor(this.id, target),
          toRuntimeScrollOptions(this.id, scrollOptions),
        ),
      reloadLatest: () => {
        this.overlay.bumpRequestEpoch()
        void this.loadLatest()
      },
      loadBefore: () => {
        getMessageListManagerRuntime(this.#runtime)
          .startEdgeRequest('before', 'command-before')
      },
      loadAfter: () => {
        getMessageListManagerRuntime(this.#runtime)
          .startEdgeRequest('after', 'command-after')
      },
    }
    this.liveSemantics = new MessageListSessionLiveSemantics({
      id: this.id,
      conversation: this.options.conversation,
      adapter: this.options.adapter,
      incoming: this.options.incoming,
      runtime: getMessageListManagerRuntime(this.#runtime),
      dataRuntime: this.#dataRuntime,
      publishSegment: (segment) => this.publishSegment(segment),
      publishLocalResetSegment: (segment) => this.publishLocalResetSegment(segment),
    })
    this.rows = createSessionRows({
      id: this.id,
      adapter: this.options.adapter,
      dataRuntime: this.#dataRuntime,
      publishSegment: (segment) => this.publishSegment(segment),
      publishLocalResetSegment: (segment) => this.publishLocalResetSegment(segment),
      clearPendingOutgoing: () => this.liveSemantics.clearPendingOutgoing(),
    })
    this.outgoing = this.liveSemantics.outgoing
    this.incoming = this.liveSemantics.incoming
    this.stateStore = createMessageListSessionState({
      id: this.id,
      runtime: this.#runtime,
      getViewState: () => this.getViewState(),
    })
    this.readReceipts = new MessageListReadReceiptsWorker(
      options.adapter,
      (keys) => this.getRowsByKeys(keys),
    )
    defineMessageListSessionInternals<Row>(this, {
      runtime: this.#runtime,
      dataRuntime: this.#dataRuntime,
      getSnapshot: () => this.getSnapshot(),
      getViewState: () => this.getViewState(),
      subscribeView: (listener) => this.subscribeView(listener),
      retainView: () => this.retainView(),
      getRow: (item) => this.getRow(item),
      getRowRenderVersion: (item) => this.getRowRenderVersion(item),
      getRowsByKeys: (keys) => this.getRowsByKeys(keys),
    })
    this.runtimeUnsubscribe = this.#runtime.subscribeRuntimeEvent((event) => {
      this.handleRuntimeEvent(event)
    })
    void this.bootstrap()
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
    this.runtimeUnsubscribe()
    this.readReceipts.destroy()
    this.overlay.destroy()
    this.stateStore.destroy()
    this.#runtime.destroy()
    this.viewListeners.clear()
  }

  private async bootstrap(): Promise<void> {
    const requestEpoch = this.overlay.getRequestEpoch()
    const overlayRequestId = this.overlay.startRequest()

    try {
      const memoryValue = await this.options.adapter.anchorMemory?.load(this.context)

      if (this.overlay.isStaleRequest(overlayRequestId) ||
        this.overlay.isStaleEpoch(requestEpoch)) {
        return
      }

      const runtimeAnchor = memoryValue
        ? normalizeMessageListAnchor(this.id, memoryValue.anchor)
        : null

      if (runtimeAnchor) {
        await this.loadAround(runtimeAnchor, undefined, {
          align: 'start',
          offsetWithinMessage: memoryValue?.offsetWithinMessage,
          overlayRequestId,
          requestEpoch,
        })
        return
      }

      await this.loadLatest(undefined, { overlayRequestId, requestEpoch })
    } catch (error) {
      if (!this.overlay.isStaleRequest(overlayRequestId) &&
        !this.overlay.isStaleEpoch(requestEpoch)) {
        this.finishOverlayRequest(
          this.emitRequestResult({ kind: 'latest', status: 'failed', error }),
          overlayRequestId,
        )
      }
    }
  }

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
    const requestSegment = this.#dataRuntime.getSegment()
    const requestGeneration = requestSegment.generation
    const requestSegmentRevision = requestSegment.segmentRevision
    if (event) {
      this.adoptRequestToken(event, 'latest')
    }
    const result = await this.runRequest('latest', event, async () => {
      const page = await this.options.adapter.request.loadLatest({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event?.requestToken,
        reason: event?.reason,
      })
      if (this.overlay.isStaleRequest(overlayRequestId) ||
        this.overlay.isStaleEpoch(requestEpoch)) {
        return {
          page,
          segment: this.#dataRuntime.getSegment(),
          applied: false,
        }
      }
      if (this.isStaleResetRequest(event, requestGeneration, requestSegmentRevision)) {
        return {
          page,
          segment: this.#dataRuntime.getSegment(),
          applied: false,
        }
      }
      const outgoing = this.liveSemantics.withPendingOutgoing(page)
      const applied = event
        ? this.#dataRuntime.resetLatestFromRequest({
            ...outgoing.resetInput,
            requestToken: event.requestToken,
          })
        : {
            applied: true,
            segment: this.#dataRuntime.resetLatest(
              outgoing.resetInput,
            ),
          }
      return { page: outgoing.page, segment: applied.segment, applied: applied.applied }
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
    const requestSegment = this.#dataRuntime.getSegment()
    const requestGeneration = requestSegment.generation
    const requestSegmentRevision = requestSegment.segmentRevision
    if (event) {
      this.adoptRequestToken(event, 'around')
    }
    const result = await this.runRequest('around', event, async () => {
      const page = await this.options.adapter.request.loadAround({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event?.requestToken,
        reason: event?.reason,
        target,
      })
      if (this.overlay.isStaleRequest(overlayRequestId) ||
        this.overlay.isStaleEpoch(requestEpoch)) {
        return {
          page,
          segment: this.#dataRuntime.getSegment(),
          applied: false,
        }
      }
      if (this.isStaleResetRequest(event, requestGeneration, requestSegmentRevision)) {
        return {
          page,
          segment: this.#dataRuntime.getSegment(),
          applied: false,
        }
      }
      const applied = event
        ? this.#dataRuntime.resetAroundFromRequest({
            ...toSessionResetInput(this.id, page, this.options.adapter),
            target,
            requestToken: event.requestToken,
            align: options.align,
            offsetWithinMessage: options.offsetWithinMessage,
          })
        : {
            applied: true,
            segment: this.#dataRuntime.resetAround({
              ...toSessionResetInput(this.id, page, this.options.adapter),
              target,
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
    const segment = this.#dataRuntime.getSegment()
    const boundaryItem = edge === 'before' ? segment.items[0] : segment.items.at(-1)
    const boundaryRow = boundaryItem?.message

    if (this.isStaleEvent(event)) {
      this.#runtime.reportEdgeRequestFailure(edge, event.requestToken)
      this.emitRequestResult({ kind: edge, status: 'stale' })
      return
    }

    if (!boundaryRow) {
      this.#runtime.reportEdgeRequestFailure(edge, event.requestToken)
      return
    }

    this.adoptRequestToken(event, edge)

    await this.runRequest(edge, event, async () => {
      const page = await (
        edge === 'before'
          ? this.options.adapter.request.loadBefore
          : this.options.adapter.request.loadAfter
      )({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event.requestToken,
        reason: event.reason,
        boundaryRow,
      })
      if (this.isStaleEvent(event)) {
        return {
          page,
          segment: this.#dataRuntime.getSegment(),
          applied: false,
        }
      }
      const currentSegment = this.#dataRuntime.getSegment()
      const input = {
        ...toSessionResetInput(this.id, page, this.options.adapter),
        hasMoreBefore: edge === 'before'
          ? page.hasMoreBefore
          : currentSegment.hasMoreBefore,
        hasMoreAfter: edge === 'after'
          ? page.hasMoreAfter
          : currentSegment.hasMoreAfter,
        requestToken: event.requestToken,
        anchor: currentSegment.anchor,
        anchorStatus: currentSegment.anchorStatus,
      }
      const applied = edge === 'before'
        ? this.#dataRuntime.extendBefore(input)
        : this.#dataRuntime.extendAfter(input)
      return { page, segment: applied.segment, applied: applied.applied }
    })
  }

  private async runRequest(
    kind: 'latest' | 'before' | 'after' | 'around',
    event: RuntimeNeedEvent | undefined,
    request: () => Promise<{
      page: MessageListPage<Row>
      segment: LoadedSegment<Row>
      applied: boolean
    }>,
  ): Promise<MessageListRequestResult<Row, Conversation>> {
    try {
      const result = await request()

      if (!result.applied) {
        if (kind === 'before' || kind === 'after') {
          this.#runtime.reportEdgeRequestFailure(kind, event?.requestToken ?? '')
        }
        return this.emitRequestResult({ kind, status: 'stale' })
      }

      this.publishSegment(result.segment)
      return this.emitRequestResult({
        kind,
        status: 'applied',
        page: result.page,
      })
    } catch (error) {
      if (kind === 'before' || kind === 'after') {
        this.#runtime.reportEdgeRequestFailure(kind, event?.requestToken ?? '')
      }
      return this.emitRequestResult({ kind, status: 'failed', error })
    }
  }

  private publishSegment(segment: LoadedSegment<Row>): void {
    let current = segment
    this.applySegmentToRuntime(current)

    for (let guard = 0; guard < 4; guard += 1) {
      const trimmed = this.#dataRuntime.trimToBudget(
        resolveTrimProtectKey(this.#runtime, this.#dataRuntime),
      )

      if (trimmed === current) {
        return
      }

      current = trimmed
      this.applySegmentToRuntime(current)
    }
  }

  private applySegmentToRuntime(segment: LoadedSegment<Row>): void {
    this.liveSemantics.settlePendingOutgoingForSegment(segment)
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
    kind: DataRuntimeRequestKind,
  ): void {
    this.#dataRuntime.adoptRequestToken({
      requestToken: event.requestToken,
      generation: event.generation,
      segmentRevision: event.segmentRevision,
      kind,
    })
  }

  private isStaleEvent(event: RuntimeNeedEvent | undefined): boolean {
    if (!event) {
      return false
    }

    const segment = this.#dataRuntime.getSegment()

    return segment.generation !== event.generation ||
      segment.segmentRevision !== event.segmentRevision
  }

  private isStaleResetRequest(
    event: RuntimeNeedEvent | undefined,
    requestGeneration: number,
    requestSegmentRevision: number,
  ): boolean {
    return event
      ? this.#dataRuntime.getSegment().generation !== event.generation
      : this.isStaleSegment(requestGeneration, requestSegmentRevision)
  }

  private isStaleSegment(
    generation: number,
    segmentRevision: number,
  ): boolean {
    const segment = this.#dataRuntime.getSegment()

    return segment.generation !== generation ||
      segment.segmentRevision !== segmentRevision
  }

  private emitRequestResult(
    result: Omit<MessageListRequestResult<Row, Conversation>, 'id' | 'conversation'>,
  ): MessageListRequestResult<Row, Conversation> {
    const next = {
      id: this.id,
      conversation: this.options.conversation,
      ...result,
    }
    this.options.onRequestResult?.(next)
    return next
  }

  private finishOverlayRequest(
    result: MessageListRequestResult<Row, Conversation>,
    overlayRequestId: number,
  ): void {
    this.overlay.finishRequest(
      overlayRequestId,
      result.status === 'failed' ? 'error' : 'idle',
      result.error,
    )
  }

  private notifyViewListeners(): void { this.stateStore.notifyViewChanged(); for (const listener of this.viewListeners) listener() }

  private touch(): void { this.lastUsedAt = Date.now() }
}
