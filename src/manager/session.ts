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
import { MessageListReadReceiptWorker } from './readReceipt'
import {
  normalizeMessageListAnchor,
  toMessageDataItems,
} from './rowAdapter'
import type {
  MessageListAdapter,
  MessageListController,
  MessageListConversationId,
  MessageListManagerOptions,
  MessageListOverlayStatus,
  MessageListPage,
  MessageListRequestResult,
  MessageListSessionContext,
  MessageListViewState,
} from './types'

type RuntimeNeedEvent = Extract<
  MessageListRuntimeEvent,
  { requestToken: string }
>

type SessionOptions<Row, Conversation> = {
  id: MessageListConversationId
  conversation: Conversation
  adapter: MessageListAdapter<Row, Conversation>
  defaults: Required<NonNullable<MessageListManagerOptions<Row, Conversation>['defaults']>>
  onRequestResult?: MessageListManagerOptions<Row, Conversation>['onRequestResult']
  onRuntimeEvent?: MessageListManagerOptions<Row, Conversation>['onRuntimeEvent']
}

export class MessageListSession<Row, Conversation>
  implements MessageListController<Row> {
  readonly id: MessageListConversationId
  readonly runtime: MessageListRuntime<Row>
  readonly dataRuntime: MessageListDataRuntime<Row>
  readonly commands: MessageListController<Row>['commands']
  private readonly context: MessageListSessionContext<Conversation>
  private readonly readReceipt: MessageListReadReceiptWorker<Row, Conversation>
  private readonly viewListeners = new Set<() => void>()
  private readonly runtimeUnsubscribe: () => void
  private readonly rowsByKey = new Map<string, Row>()
  private overlayStatus: MessageListOverlayStatus
  private viewState: MessageListViewState
  private overlayRequestId = 0
  lastUsedAt = Date.now()

  constructor(private readonly options: SessionOptions<Row, Conversation>) {
    this.id = options.id
    this.context = {
      id: options.id,
      conversation: options.conversation,
    }
    this.runtime = createMessageListRuntime<Row>({ feedId: options.id })
    this.dataRuntime = createMessageListDataRuntime<Row>({
      feedId: options.id,
      itemBudget: options.defaults.maxItems,
    })
    this.commands = {
      scrollToLatest: () => this.runtime.scrollToLatest(),
      scrollToMessage: (target, scrollOptions) =>
        this.runtime.scrollToMessage(target, scrollOptions),
      reloadLatest: () => {
        void this.loadLatest()
      },
    }
    this.overlayStatus = this.createOverlayStatus('idle')
    this.viewState = {
      overlayStatus: this.overlayStatus,
    }
    this.readReceipt = new MessageListReadReceiptWorker(
      options.adapter,
      (keys) => this.getRowsByKeys(keys),
    )
    this.runtimeUnsubscribe = this.runtime.subscribeRuntimeEvent((event) => {
      this.handleRuntimeEvent(event)
    })
    void this.bootstrap()
  }

  getSnapshot(): MessageListSnapshot<Row> {
    return this.runtime.getSnapshot()
  }

  getViewState(): MessageListViewState {
    return this.viewState
  }

  subscribeView(listener: () => void): () => void {
    this.viewListeners.add(listener)
    return () => this.viewListeners.delete(listener)
  }

  getRow(item: MessageDataItem<Row>): Row | null {
    return item.message ?? null
  }

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
    this.readReceipt.destroy()
    this.runtime.destroy()
    this.viewListeners.clear()
  }

  private async bootstrap(): Promise<void> {
    try {
      this.setOverlayStatus('loading')
      const anchor = await this.options.adapter.memory?.loadAnchor(this.context)
      const runtimeAnchor = anchor
        ? normalizeMessageListAnchor(this.id, anchor)
        : null

      if (runtimeAnchor) {
        await this.loadAround(runtimeAnchor)
        return
      }

      await this.loadLatest()
    } catch (error) {
      this.setOverlayStatus('error', error)
    }
  }

  private handleRuntimeEvent(event: MessageListRuntimeEvent): void {
    this.touch()
    this.options.onRuntimeEvent?.(event, this.context)

    if (event.type === 'viewportAnchorChanged' && event.anchor) {
      void this.options.adapter.memory?.saveAnchor(
        this.context,
        event.anchor,
        event.offsetWithinMessage,
      )
      return
    }

    if (event.type === 'viewportObservationChanged') {
      this.readReceipt.handleObservation(event)
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

  private async loadLatest(event?: RuntimeNeedEvent): Promise<void> {
    const overlayRequestId = this.startOverlayRequest()
    const result = await this.runRequest('latest', event, async () => {
      const page = await this.options.adapter.request.loadLatest({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event?.requestToken,
        reason: event?.reason,
      })
      if (this.isStaleOverlayRequest(overlayRequestId)) {
        return {
          page,
          segment: this.dataRuntime.getSegment(),
          applied: false,
        }
      }
      if (event) this.adoptRequestToken(event, 'latest')
      const applied = event
        ? this.dataRuntime.resetLatestFromRequest({
            ...this.toResetInput(page),
            requestToken: event.requestToken,
          })
        : {
            applied: true,
            segment: this.dataRuntime.resetLatest(this.toResetInput(page)),
          }
      return { page, segment: applied.segment, applied: applied.applied }
    })
    this.finishOverlayRequest(result, overlayRequestId)
  }

  private async loadAround(
    target: MessageIdentityAnchor,
    event?: RuntimeNeedEvent,
  ): Promise<void> {
    const overlayRequestId = this.startOverlayRequest()
    const result = await this.runRequest('around', event, async () => {
      const page = await this.options.adapter.request.loadAround({
        ...this.context,
        pageSize: this.options.defaults.pageSize,
        requestToken: event?.requestToken,
        reason: event?.reason,
        target,
      })
      if (this.isStaleOverlayRequest(overlayRequestId)) {
        return {
          page,
          segment: this.dataRuntime.getSegment(),
          applied: false,
        }
      }
      if (event) this.adoptRequestToken(event, 'around')
      const applied = event
        ? this.dataRuntime.resetAroundFromRequest({
            ...this.toResetInput(page),
            target,
            requestToken: event.requestToken,
          })
        : {
            applied: true,
            segment: this.dataRuntime.resetAround({
              ...this.toResetInput(page),
              target,
            }),
          }
      return { page, segment: applied.segment, applied: applied.applied }
    })
    this.finishOverlayRequest(result, overlayRequestId)
  }

  private async loadEdge(event: RuntimeNeedEvent): Promise<void> {
    const edge = event.type === 'needMoreBefore' ? 'before' : 'after'
    const segment = this.dataRuntime.getSegment()
    const boundaryItem = edge === 'before' ? segment.items[0] : segment.items.at(-1)
    const boundaryRow = boundaryItem?.message

    if (!boundaryRow) {
      this.runtime.reportEdgeRequestFailure(edge, event.requestToken)
      return
    }

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
      this.adoptRequestToken(event, edge)
      const input = {
        ...this.toResetInput(page),
        requestToken: event.requestToken,
        anchor: segment.anchor,
        anchorStatus: segment.anchorStatus,
      }
      const applied = edge === 'before'
        ? this.dataRuntime.extendBefore(input)
        : this.dataRuntime.extendAfter(input)
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

      if (!result.applied || this.isStaleEvent(event)) {
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
        this.runtime.reportEdgeRequestFailure(kind, event?.requestToken ?? '')
      }
      return this.emitRequestResult({ kind, status: 'failed', error })
    }
  }

  private publishSegment(segment: LoadedSegment<Row>): void {
    let current = segment
    this.applySegmentToRuntime(current)

    for (let guard = 0; guard < 4; guard += 1) {
      const trimmed = this.dataRuntime.trimToBudget(this.resolveTrimProtectKey())

      if (trimmed === current) {
        return
      }

      current = trimmed
      this.applySegmentToRuntime(current)
    }
  }

  private applySegmentToRuntime(segment: LoadedSegment<Row>): void {
    this.reindexRows(segment.items)
    this.runtime.applyLoadedSegment(segment)
  }

  private reindexRows(items: MessageDataItem<Row>[]): void {
    this.rowsByKey.clear()

    for (const item of items) {
      if (item.message !== undefined) {
        this.rowsByKey.set(item.key, item.message)
      }
    }
  }

  private toResetInput(page: MessageListPage<Row>) {
    return {
      items: toMessageDataItems(this.id, page.rows, this.options.adapter),
      hasMoreBefore: page.hasMoreBefore,
      hasMoreAfter: page.hasMoreAfter,
      anchor: page.anchor
        ? normalizeMessageListAnchor(this.id, page.anchor)
        : undefined,
      anchorStatus: page.anchorStatus,
    }
  }

  private adoptRequestToken(
    event: RuntimeNeedEvent,
    kind: DataRuntimeRequestKind,
  ): void {
    this.dataRuntime.adoptRequestToken({
      requestToken: event.requestToken,
      generation: event.generation,
      kind,
    })
  }

  private isStaleEvent(event: RuntimeNeedEvent | undefined): boolean {
    return Boolean(event && this.dataRuntime.getSegment().generation !== event.generation)
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
    if (overlayRequestId !== this.overlayRequestId) {
      return
    }

    this.setOverlayStatus(result.status === 'failed' ? 'error' : 'idle', result.error)
  }

  private resolveTrimProtectKey(): string | undefined {
    const anchor = this.runtime.getViewportAnchor()
    const segment = this.dataRuntime.getSegment()

    if (!anchor) {
      return this.runtime.getSnapshot().bottomLockState === 'LOCKED'
        ? segment.items.at(-1)?.key
        : segment.items[Math.floor(segment.items.length / 2)]?.key
    }

    return segment.items.find((item) => {
      const identity = item.identity
      return identity &&
        identity.feedId === anchor.feedId &&
        (
          identity.stableId === anchor.stableId ||
          Boolean(identity.serverId && identity.serverId === anchor.serverId) ||
          Boolean(identity.localId && identity.localId === anchor.localId)
        )
    })?.key
  }

  private createOverlayStatus(
    status: MessageListOverlayStatus['status'],
    error?: unknown,
  ): MessageListOverlayStatus {
    return {
      status,
      error,
      retry: () => {
        void this.bootstrap()
      },
    }
  }

  private setOverlayStatus(
    status: MessageListOverlayStatus['status'],
    error?: unknown,
  ): void {
    this.overlayStatus = this.createOverlayStatus(status, error)
    this.viewState = {
      overlayStatus: this.overlayStatus,
    }
    for (const listener of this.viewListeners) listener()
  }

  private startOverlayRequest(): number {
    this.overlayRequestId += 1
    this.setOverlayStatus('loading')
    return this.overlayRequestId
  }

  private isStaleOverlayRequest(overlayRequestId: number): boolean {
    return overlayRequestId !== this.overlayRequestId
  }

  private touch(): void {
    this.lastUsedAt = Date.now()
  }
}
