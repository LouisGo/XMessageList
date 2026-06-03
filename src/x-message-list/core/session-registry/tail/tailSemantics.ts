import type {
  LoadedSegment,
  MessageDataItem,
  MessageIdentityAnchor,
} from '../../runtime/index'
import type { MessageListManagerRuntime } from '../../runtime/internal'
import type {
  MessageListDataRuntime,
  ResetSegmentInput,
} from '../../runtime/data/index'
import { toMessageDataItems } from '../adapters/rowAdapter'
import {
  toSessionIdentityRemaps,
  toSessionResetInput,
} from '../session/helpers'
import type {
  MessageListAdapter,
  MessageListConversationId,
  MessageListIdentityRemap,
  MessageListIncomingAppendContext,
  MessageListIncomingAppendFollowDecision,
  MessageListIncomingAppendInput,
  MessageListManagerOptions,
  MessageListOutgoingStageInput,
  MessageListPage,
  MessageListSession as PublicMessageListSession,
} from '../contracts'

type SessionLiveSemanticsOptions<Row, Conversation> = {
  id: MessageListConversationId
  conversation: Conversation
  adapter: MessageListAdapter<Row, Conversation>
  incoming?: MessageListManagerOptions<Row, Conversation>['incoming']
  runtime: MessageListManagerRuntime<Row>
  dataRuntime: MessageListDataRuntime<Row>
  publishSegment: (segment: LoadedSegment<Row>) => void
  publishLocalResetSegment: (segment: LoadedSegment<Row>) => void
}

export class MessageListSessionLiveSemantics<Row, Conversation> {
  readonly tail: PublicMessageListSession<Row>['tail']
  readonly outgoing: PublicMessageListSession<Row>['outgoing']
  readonly incoming: PublicMessageListSession<Row>['incoming']
  private readonly pendingOutgoingItemsByKey = new Map<string, MessageDataItem<Row>>()
  private readonly pendingOutgoingRetireKeys = new Set<string>()

  constructor(private readonly options: SessionLiveSemanticsOptions<Row, Conversation>) {
    const local = {
      stage: (input) => this.stageOutgoing(input),
      patch: (rows) => this.patchOutgoing(rows),
      applyIdentityRemap: (remaps) => this.applyOutgoingIdentityRemap(remaps),
    }
    const remote = {
      append: (input) => this.appendIncoming(input),
    }
    this.tail = {
      local,
      remote,
    }
    this.outgoing = local
    this.incoming = remote
  }

  withPendingOutgoing(page: MessageListPage<Row>): {
    page: MessageListPage<Row>
    resetInput: ResetSegmentInput<Row, unknown>
  } {
    const resetInput = toSessionResetInput(
      this.options.id,
      page,
      this.options.adapter,
    )
    const items = filterRetiredItems(resetInput.items, this.pendingOutgoingRetireKeys)
    const pending = filterRetiredItems(
      [...this.pendingOutgoingItemsByKey.values()],
      this.pendingOutgoingRetireKeys,
    )

    if (pending.length === 0 && items === resetInput.items) {
      return { page, resetInput }
    }

    const mergedItems = mergeOutgoingItems(items, pending)
    return {
      page: {
        ...page,
        rows: mergedItems
          .map((item) => item.message)
          .filter((row): row is Row => row !== undefined),
      },
      resetInput: {
        ...resetInput,
        items: mergedItems,
      },
    }
  }

  settlePendingOutgoingForSegment(segment: LoadedSegment<Row>): void {
    if (segment.hasMoreAfter) {
      return
    }

    for (const [key, pending] of [...this.pendingOutgoingItemsByKey]) {
      if (segment.items.some((item) =>
        item.key === pending.key || itemsShareIdentity(item, pending)
      )) {
        this.pendingOutgoingItemsByKey.delete(key)
      }
    }

    if (this.pendingOutgoingItemsByKey.size === 0) {
      this.pendingOutgoingRetireKeys.clear()
    }
  }

  clearPendingOutgoing(): void {
    this.pendingOutgoingItemsByKey.clear()
    this.pendingOutgoingRetireKeys.clear()
  }

  private stageOutgoing(
    input: Row | Row[] | MessageListOutgoingStageInput<Row>,
  ): void {
    const stage = normalizeOutgoingStageInput(input)

    if (stage.rows.length === 0) {
      return
    }

    const items = this.toDataItems(stage.rows)
    this.rememberRetireKeys(stage.retireKeys)
    this.forgetPendingOutgoingKeys(stage.retireKeys)
    const segment = this.options.dataRuntime.getSegment()

    if (stage.latest) {
      this.rememberPendingOutgoing(items)
      this.options.runtime.prepareFollowBottomForLocalReset()
      const { resetInput } = this.withPendingOutgoing(stage.latest)
      this.options.publishLocalResetSegment(
        this.options.dataRuntime.resetLatest(resetInput),
      )
      return
    }

    this.options.runtime.scrollToLatest()

    if (!segment.hasMoreAfter) {
      this.options.publishSegment(
        this.options.dataRuntime.appendItems(items, {
          follow: 'follow',
          retireKeys: stage.retireKeys,
        }),
      )
      return
    }

    this.rememberPendingOutgoing(items)
  }

  private appendIncoming(
    input: Row | Row[] | MessageListIncomingAppendInput<Row>,
  ): void {
    const append = normalizeIncomingAppendInput(input)

    if (append.rows.length === 0) {
      return
    }

    if (this.options.dataRuntime.getSegment().hasMoreAfter) {
      return
    }

    const follow = this.resolveIncomingAppendFollow(append)

    if (follow === 'follow') {
      this.options.runtime.scrollToLatest()
    }

    this.options.publishSegment(this.options.dataRuntime.appendItems(
      this.toDataItems(append.rows),
      { follow },
    ))
  }

  private patchOutgoing(rows: Row[]): void {
    if (rows.length === 0) {
      return
    }

    const items = this.toDataItems(rows)
    this.updatePendingOutgoing(items)

    const visibleKeys = new Set(
      this.options.dataRuntime.getSegment().items.map((item) => item.key),
    )
    const visibleItems = items.filter((item) => visibleKeys.has(item.key))

    if (visibleItems.length > 0) {
      this.options.publishSegment(this.options.dataRuntime.patchItems(visibleItems))
    }
  }

  private applyOutgoingIdentityRemap(remaps: MessageListIdentityRemap[]): void {
    if (remaps.length === 0) {
      return
    }

    const runtimeRemaps = toSessionIdentityRemaps(this.options.id, remaps)
    this.remapPendingOutgoing(runtimeRemaps)

    const segment = this.options.dataRuntime.getSegment()
    const touchesVisible = runtimeRemaps.some((remap) =>
      segment.items.some((item) =>
        item.key === remap.previousKey ||
          item.key === remap.nextKey ||
          itemMatchesAnchor(item, remap.from)
      ),
    )

    if (touchesVisible) {
      this.options.publishSegment(
        this.options.dataRuntime.applyIdentityRemap(runtimeRemaps),
      )
    }
  }

  private resolveIncomingAppendFollow(
    input: MessageListIncomingAppendInput<Row>,
  ): MessageListIncomingAppendFollowDecision {
    const context = this.createIncomingAppendContext(input)
    const explicit = resolveIncomingAppendFollowInput(input.follow, context)

    if (explicit) {
      return explicit
    }

    const configured = this.options.incoming?.shouldFollowAppend?.(
      context as MessageListIncomingAppendContext<Row, Conversation>,
    )
    const resolvedConfigured = normalizeIncomingAppendFollowDecision(configured)

    if (resolvedConfigured) {
      return resolvedConfigured
    }

    if (context.hasMoreAfter) {
      return 'preserve'
    }

    return context.bottomLockState === 'LOCKED' ||
      context.pendingIntent === 'follow-bottom'
      ? 'follow'
      : 'preserve'
  }

  private createIncomingAppendContext(
    input: MessageListIncomingAppendInput<Row>,
  ): MessageListIncomingAppendContext<Row, Conversation> {
    const snapshot = this.options.runtime.getSnapshot()
    const evidence = this.options.runtime.getEvidence()
    const distanceToBottom = Math.max(
      0,
      evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop,
    )

    return {
      id: this.options.id,
      sessionId: this.options.id,
      feedId: this.options.id,
      conversation: this.options.conversation,
      feed: this.options.conversation,
      rows: input.rows,
      reason: input.reason,
      hasMoreAfter: snapshot.segmentMeta.hasMoreAfter,
      bottomLockState: snapshot.bottomLockState,
      pendingIntent: snapshot.pendingIntent,
      viewportPhase: snapshot.viewportPhase,
      distanceToBottom,
      pageFocused: resolvePageFocus(this.options.incoming?.getPageFocus),
    }
  }

  private toDataItems(rows: Row[]): MessageDataItem<Row>[] {
    return toMessageDataItems(this.options.id, rows, this.options.adapter)
  }

  private rememberPendingOutgoing(items: MessageDataItem<Row>[]): void {
    for (const item of items) {
      this.pendingOutgoingItemsByKey.set(item.key, item)
    }
  }

  private forgetPendingOutgoingKeys(keys: string[] | undefined): void {
    if (!keys || keys.length === 0) {
      return
    }

    for (const key of keys) {
      this.pendingOutgoingItemsByKey.delete(key)
    }
  }

  private rememberRetireKeys(keys: string[] | undefined): void {
    if (!keys || keys.length === 0) {
      return
    }

    for (const key of keys) {
      this.pendingOutgoingRetireKeys.add(key)
    }
  }

  private updatePendingOutgoing(items: MessageDataItem<Row>[]): void {
    for (const item of items) {
      const existingKey = this.findPendingOutgoingKey(item)

      if (existingKey && existingKey !== item.key) {
        this.pendingOutgoingItemsByKey.delete(existingKey)
      }

      if (existingKey || this.pendingOutgoingItemsByKey.has(item.key)) {
        this.pendingOutgoingItemsByKey.set(item.key, item)
      }
    }
  }

  private remapPendingOutgoing(
    remaps: ReturnType<typeof toSessionIdentityRemaps>,
  ): void {
    for (const [key, item] of [...this.pendingOutgoingItemsByKey]) {
      const remap = remaps.find((candidate) =>
        candidate.previousKey === item.key || itemMatchesAnchor(item, candidate.from)
      )

      if (!remap) {
        continue
      }

      this.pendingOutgoingItemsByKey.delete(key)
      this.pendingOutgoingItemsByKey.set(remap.nextKey, {
        ...item,
        key: remap.nextKey,
        identity: {
          feedId: remap.to.feedId,
          stableId: remap.to.stableId,
          serverId: remap.to.serverId,
          localId: remap.to.localId,
          version: (item.identity?.version ?? 0) + 1,
        },
      })
    }
  }

  private findPendingOutgoingKey(item: MessageDataItem<Row>): string | null {
    if (this.pendingOutgoingItemsByKey.has(item.key)) {
      return item.key
    }

    for (const [key, pending] of this.pendingOutgoingItemsByKey) {
      if (itemsShareIdentity(pending, item)) {
        return key
      }
    }

    return null
  }
}

function normalizeOutgoingStageInput<Row>(
  input: Row | Row[] | MessageListOutgoingStageInput<Row>,
): MessageListOutgoingStageInput<Row> {
  if (Array.isArray(input)) {
    return { rows: input, reason: 'send' }
  }

  if (isOutgoingStageInput<Row>(input)) {
    return {
      rows: input.rows,
      latest: input.latest,
      reason: input.reason ?? 'send',
      retireKeys: input.retireKeys,
    }
  }

  return { rows: [input], reason: 'send' }
}

function normalizeIncomingAppendInput<Row>(
  input: Row | Row[] | MessageListIncomingAppendInput<Row>,
): MessageListIncomingAppendInput<Row> {
  if (Array.isArray(input)) {
    return { rows: input }
  }

  if (isIncomingAppendInput<Row>(input)) {
    return {
      rows: input.rows,
      reason: input.reason,
      follow: input.follow,
    }
  }

  return { rows: [input] }
}

function isOutgoingStageInput<Row>(
  input: Row | MessageListOutgoingStageInput<Row>,
): input is MessageListOutgoingStageInput<Row> {
  if (!input || typeof input !== 'object') {
    return false
  }

  const candidate = input as { rows?: unknown; latest?: unknown; reason?: unknown }
  return Array.isArray(candidate.rows) &&
    (
      'latest' in candidate ||
      'reason' in candidate ||
      'retireKeys' in candidate ||
      Object.keys(candidate).length === 1
    )
}

function isIncomingAppendInput<Row>(
  input: Row | MessageListIncomingAppendInput<Row>,
): input is MessageListIncomingAppendInput<Row> {
  if (!input || typeof input !== 'object') {
    return false
  }

  const candidate = input as { rows?: unknown; reason?: unknown; follow?: unknown }
  return Array.isArray(candidate.rows) &&
    (
      'reason' in candidate ||
      'follow' in candidate ||
      Object.keys(candidate).length === 1
    )
}

function resolveIncomingAppendFollowInput<Row>(
  follow: MessageListIncomingAppendInput<Row>['follow'],
  context: MessageListIncomingAppendContext<Row>,
): MessageListIncomingAppendFollowDecision | null {
  if (typeof follow === 'function') {
    return normalizeIncomingAppendFollowDecision(follow(context))
  }

  return normalizeIncomingAppendFollowDecision(follow)
}

function normalizeIncomingAppendFollowDecision(
  decision:
    | MessageListIncomingAppendInput<unknown>['follow']
    | MessageListIncomingAppendFollowDecision
    | boolean
    | undefined,
): MessageListIncomingAppendFollowDecision | null {
  if (decision === true || decision === 'follow') {
    return 'follow'
  }

  if (decision === false || decision === 'preserve') {
    return 'preserve'
  }

  return null
}

function resolvePageFocus(getPageFocus?: () => boolean): boolean {
  if (getPageFocus) {
    return getPageFocus()
  }

  const maybeDocument = globalThis as typeof globalThis & {
    document?: { hasFocus?: () => boolean }
  }

  return maybeDocument.document?.hasFocus?.() ?? true
}

function mergeOutgoingItems<Row>(
  items: MessageDataItem<Row>[],
  outgoingItems: MessageDataItem<Row>[],
): MessageDataItem<Row>[] {
  const next: MessageDataItem<Row>[] = []
  const seenKeys = new Set<string>()
  const seenIdentityTokens = new Set<string>()

  for (const item of [...items, ...outgoingItems]) {
    const tokens = identityTokens(item)

    if (
      seenKeys.has(item.key) ||
      tokens.some((token) => seenIdentityTokens.has(token))
    ) {
      continue
    }

    seenKeys.add(item.key)
    for (const token of tokens) {
      seenIdentityTokens.add(token)
    }
    next.push(item)
  }

  return next
}

function filterRetiredItems<Row>(
  items: MessageDataItem<Row>[],
  retireKeys: Set<string>,
): MessageDataItem<Row>[] {
  if (retireKeys.size === 0) {
    return items
  }

  return items.filter((item) => !retireKeys.has(item.key))
}

function itemsShareIdentity<Row>(
  left: MessageDataItem<Row>,
  right: MessageDataItem<Row>,
): boolean {
  const leftTokens = new Set(identityTokens(left))

  return identityTokens(right).some((token) => leftTokens.has(token))
}

function itemMatchesAnchor<Row>(
  item: MessageDataItem<Row>,
  anchor: MessageIdentityAnchor,
): boolean {
  const identity = item.identity

  return Boolean(
    identity &&
      identity.feedId === anchor.feedId &&
      (
        identity.stableId === anchor.stableId ||
        Boolean(identity.serverId && identity.serverId === anchor.serverId) ||
        Boolean(identity.localId && identity.localId === anchor.localId)
      ),
  )
}

function identityTokens<Row>(item: MessageDataItem<Row>): string[] {
  const identity = item.identity

  if (!identity) {
    return []
  }

  return [
    `${identity.feedId}|stable:${identity.stableId}`,
    identity.serverId ? `${identity.feedId}|server:${identity.serverId}` : '',
    identity.localId ? `${identity.feedId}|local:${identity.localId}` : '',
  ].filter(Boolean)
}
