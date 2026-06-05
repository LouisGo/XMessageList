import type {
  LoadedSegment,
  MessageDataItem,
  MessageIdentityAnchor,
} from '../../runtime/index'
import type { MessageListSessionRegistryRuntime } from '../../runtime/internal'
import type {
  LoadedSegmentStore,
  ResetSegmentInput,
} from '../loaded-segment-store/index'
import { toMessageDataItems } from '../adapters/rowAdapter'
import {
  toSessionIdentityRemaps,
  toSessionResetInput,
} from '../session/helpers'
import type {
  MessageListAdapter,
  MessageListIdentityRemap,
  MessageListLocalTailStageInput,
  MessageListPage,
  MessageListRemoteTailAppendConfig,
  MessageListRemoteTailAppendContext,
  MessageListRemoteTailAppendInput,
  MessageListSession as PublicMessageListSession,
  MessageListSessionId,
  MessageListTailAppendFollowDecision,
} from '../contracts'

type SessionLiveSemanticsOptions<Row, Source> = {
  sessionId: MessageListSessionId
  source: Source
  adapter: MessageListAdapter<Row, Source>
  tailEvents?: MessageListRemoteTailAppendConfig<Row, Source>
  runtime: MessageListSessionRegistryRuntime<Row>
  loadedSegmentStore: LoadedSegmentStore<Row>
  publishSegment: (segment: LoadedSegment<Row>) => void
  publishLocalResetSegment: (segment: LoadedSegment<Row>) => void
}

export class MessageListSessionLiveSemantics<Row, Source> {
  readonly tail: PublicMessageListSession<Row>['tail']
  private readonly pendingLocalItemsByKey = new Map<string, MessageDataItem<Row>>()
  private readonly pendingLocalRetireKeys = new Set<string>()

  constructor(private readonly options: SessionLiveSemanticsOptions<Row, Source>) {
    this.tail = {
      local: {
        stage: (input) => this.stageLocal(input),
        patch: (rows) => this.patchLocal(rows),
        applyIdentityRemap: (remaps) => this.applyLocalIdentityRemap(remaps),
      },
      remote: {
        append: (input) => this.appendRemote(input),
      },
    }
  }

  withPendingLocal(page: MessageListPage<Row>): {
    page: MessageListPage<Row>
    resetInput: ResetSegmentInput<Row, unknown>
  } {
    const resetInput = toSessionResetInput(
      this.options.sessionId,
      page,
      this.options.adapter,
    )
    const items = filterRetiredItems(resetInput.items, this.pendingLocalRetireKeys)
    const pending = filterRetiredItems(
      [...this.pendingLocalItemsByKey.values()],
      this.pendingLocalRetireKeys,
    )

    if (pending.length === 0 && items === resetInput.items) {
      return { page, resetInput }
    }

    const mergedItems = mergeLocalItems(items, pending)
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

  settlePendingLocalForSegment(segment: LoadedSegment<Row>): void {
    if (segment.hasMoreAfter) {
      return
    }

    for (const [key, pending] of [...this.pendingLocalItemsByKey]) {
      if (segment.items.some((item) =>
        item.key === pending.key || itemsShareIdentity(item, pending)
      )) {
        this.pendingLocalItemsByKey.delete(key)
      }
    }

    if (this.pendingLocalItemsByKey.size === 0) {
      this.pendingLocalRetireKeys.clear()
    }
  }

  clearPendingLocal(): void {
    this.pendingLocalItemsByKey.clear()
    this.pendingLocalRetireKeys.clear()
  }

  private stageLocal(
    input: Row | Row[] | MessageListLocalTailStageInput<Row>,
  ): void {
    const stage = normalizeLocalTailStageInput(input)

    if (stage.rows.length === 0) {
      return
    }

    const items = this.toDataItems(stage.rows)
    this.rememberRetireKeys(stage.retireKeys)
    this.forgetPendingLocalKeys(stage.retireKeys)
    const segment = this.options.loadedSegmentStore.getSegment()

    if (stage.latest) {
      this.rememberPendingLocal(items)
      this.options.runtime.prepareFollowBottomForLocalReset()
      const { resetInput } = this.withPendingLocal(stage.latest)
      this.options.publishLocalResetSegment(
        this.options.loadedSegmentStore.resetLatest(resetInput),
      )
      return
    }

    this.options.runtime.scrollToLatest()

    if (!segment.hasMoreAfter) {
      this.options.publishSegment(
        this.options.loadedSegmentStore.appendItems(items, {
          follow: 'follow',
          retireKeys: stage.retireKeys,
        }),
      )
      return
    }

    this.rememberPendingLocal(items)
  }

  private appendRemote(
    input: Row | Row[] | MessageListRemoteTailAppendInput<Row>,
  ): void {
    const append = normalizeRemoteTailAppendInput(input)

    if (append.rows.length === 0) {
      return
    }

    if (this.options.loadedSegmentStore.getSegment().hasMoreAfter) {
      return
    }

    const follow = this.resolveRemoteAppendFollow(append)

    if (follow === 'follow') {
      this.options.runtime.scrollToLatest()
    }

    this.options.publishSegment(this.options.loadedSegmentStore.appendItems(
      this.toDataItems(append.rows),
      { follow },
    ))
  }

  private patchLocal(rows: Row[]): void {
    if (rows.length === 0) {
      return
    }

    const items = this.toDataItems(rows)
    this.updatePendingLocal(items)

    const visibleKeys = new Set(
      this.options.loadedSegmentStore.getSegment().items.map((item) => item.key),
    )
    const visibleItems = items.filter((item) => visibleKeys.has(item.key))

    if (visibleItems.length > 0) {
      this.options.publishSegment(this.options.loadedSegmentStore.patchItems(visibleItems))
    }
  }

  private applyLocalIdentityRemap(remaps: MessageListIdentityRemap[]): void {
    if (remaps.length === 0) {
      return
    }

    const runtimeRemaps = toSessionIdentityRemaps(this.options.sessionId, remaps)
    this.remapPendingLocal(runtimeRemaps)

    const segment = this.options.loadedSegmentStore.getSegment()
    const touchesVisible = runtimeRemaps.some((remap) =>
      segment.items.some((item) =>
        item.key === remap.previousKey ||
          item.key === remap.nextKey ||
          itemMatchesAnchor(item, remap.from)
      ),
    )

    if (touchesVisible) {
      this.options.publishSegment(
        this.options.loadedSegmentStore.applyIdentityRemap(runtimeRemaps),
      )
    }
  }

  private resolveRemoteAppendFollow(
    input: MessageListRemoteTailAppendInput<Row>,
  ): MessageListTailAppendFollowDecision {
    const context = this.createRemoteAppendContext(input)
    const explicit = resolveRemoteAppendFollowInput(input.follow, context)

    if (explicit) {
      return explicit
    }

    const configured = this.options.tailEvents?.shouldFollowRemoteAppend?.(
      context,
    )
    const resolvedConfigured = normalizeRemoteAppendFollowDecision(configured)

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

  private createRemoteAppendContext(
    input: MessageListRemoteTailAppendInput<Row>,
  ): MessageListRemoteTailAppendContext<Row, Source> {
    const snapshot = this.options.runtime.getSnapshot()
    const evidence = this.options.runtime.getEvidence()
    const distanceToBottom = Math.max(
      0,
      evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop,
    )

    return {
      sessionId: this.options.sessionId,
      source: this.options.source,
      rows: input.rows,
      reason: input.reason,
      hasMoreAfter: snapshot.segmentMeta.hasMoreAfter,
      bottomLockState: snapshot.bottomLockState,
      pendingIntent: snapshot.pendingIntent,
      viewportPhase: snapshot.viewportPhase,
      distanceToBottom,
      pageFocused: resolvePageFocus(this.options.tailEvents?.getPageFocus),
    }
  }

  private toDataItems(rows: Row[]): MessageDataItem<Row>[] {
    return toMessageDataItems(this.options.sessionId, rows, this.options.adapter)
  }

  private rememberPendingLocal(items: MessageDataItem<Row>[]): void {
    for (const item of items) {
      this.pendingLocalItemsByKey.set(item.key, item)
    }
  }

  private forgetPendingLocalKeys(keys: string[] | undefined): void {
    if (!keys || keys.length === 0) {
      return
    }

    for (const key of keys) {
      this.pendingLocalItemsByKey.delete(key)
    }
  }

  private rememberRetireKeys(keys: string[] | undefined): void {
    if (!keys || keys.length === 0) {
      return
    }

    for (const key of keys) {
      this.pendingLocalRetireKeys.add(key)
    }
  }

  private updatePendingLocal(items: MessageDataItem<Row>[]): void {
    for (const item of items) {
      const existingKey = this.findPendingLocalKey(item)

      if (existingKey && existingKey !== item.key) {
        this.pendingLocalItemsByKey.delete(existingKey)
      }

      if (existingKey || this.pendingLocalItemsByKey.has(item.key)) {
        this.pendingLocalItemsByKey.set(item.key, item)
      }
    }
  }

  private remapPendingLocal(
    remaps: ReturnType<typeof toSessionIdentityRemaps>,
  ): void {
    for (const [key, item] of [...this.pendingLocalItemsByKey]) {
      const remap = remaps.find((candidate) =>
        candidate.previousKey === item.key || itemMatchesAnchor(item, candidate.from)
      )

      if (!remap) {
        continue
      }

      this.pendingLocalItemsByKey.delete(key)
      this.pendingLocalItemsByKey.set(remap.nextKey, {
        ...item,
        key: remap.nextKey,
        identity: {
          sessionId: remap.to.sessionId,
          stableId: remap.to.stableId,
          serverId: remap.to.serverId,
          localId: remap.to.localId,
          version: (item.identity?.version ?? 0) + 1,
        },
      })
    }
  }

  private findPendingLocalKey(item: MessageDataItem<Row>): string | null {
    if (this.pendingLocalItemsByKey.has(item.key)) {
      return item.key
    }

    for (const [key, pending] of this.pendingLocalItemsByKey) {
      if (itemsShareIdentity(pending, item)) {
        return key
      }
    }

    return null
  }
}

function normalizeLocalTailStageInput<Row>(
  input: Row | Row[] | MessageListLocalTailStageInput<Row>,
): MessageListLocalTailStageInput<Row> {
  if (Array.isArray(input)) {
    return { rows: input, reason: 'send' }
  }

  if (isLocalTailStageInput<Row>(input)) {
    return {
      rows: input.rows,
      latest: input.latest,
      reason: input.reason ?? 'send',
      retireKeys: input.retireKeys,
    }
  }

  return { rows: [input], reason: 'send' }
}

function normalizeRemoteTailAppendInput<Row>(
  input: Row | Row[] | MessageListRemoteTailAppendInput<Row>,
): MessageListRemoteTailAppendInput<Row> {
  if (Array.isArray(input)) {
    return { rows: input }
  }

  if (isRemoteTailAppendInput<Row>(input)) {
    return {
      rows: input.rows,
      reason: input.reason,
      follow: input.follow,
    }
  }

  return { rows: [input] }
}

function isLocalTailStageInput<Row>(
  input: Row | MessageListLocalTailStageInput<Row>,
): input is MessageListLocalTailStageInput<Row> {
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

function isRemoteTailAppendInput<Row>(
  input: Row | MessageListRemoteTailAppendInput<Row>,
): input is MessageListRemoteTailAppendInput<Row> {
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

function resolveRemoteAppendFollowInput<Row>(
  follow: MessageListRemoteTailAppendInput<Row>['follow'],
  context: MessageListRemoteTailAppendContext<Row>,
): MessageListTailAppendFollowDecision | null {
  if (typeof follow === 'function') {
    return normalizeRemoteAppendFollowDecision(follow(context))
  }

  return normalizeRemoteAppendFollowDecision(follow)
}

function normalizeRemoteAppendFollowDecision(
  decision:
    | MessageListRemoteTailAppendInput<unknown>['follow']
    | MessageListTailAppendFollowDecision
    | boolean
    | undefined,
): MessageListTailAppendFollowDecision | null {
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

function mergeLocalItems<Row>(
  items: MessageDataItem<Row>[],
  localItems: MessageDataItem<Row>[],
): MessageDataItem<Row>[] {
  const next: MessageDataItem<Row>[] = []
  const seenKeys = new Set<string>()
  const seenIdentityTokens = new Set<string>()

  for (const item of [...items, ...localItems]) {
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
      identity.sessionId === anchor.sessionId &&
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
    `${identity.sessionId}|stable:${identity.stableId}`,
    identity.serverId ? `${identity.sessionId}|server:${identity.serverId}` : '',
    identity.localId ? `${identity.sessionId}|local:${identity.localId}` : '',
  ].filter(Boolean)
}
