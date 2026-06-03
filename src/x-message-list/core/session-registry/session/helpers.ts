import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageListRuntime,
  MessageListRuntimeEvent,
  MessageListScrollToMessageOptions as RuntimeScrollToMessageOptions,
  ResetAroundAlign,
} from '../../runtime/index'
import type {
  IdentityRemapInput,
  MessageListDataRuntime,
  ReplaceSegmentInput,
  ResetSegmentInput,
} from '../../runtime/data/index'
import {
  normalizeMessageListAnchor,
  toMessageDataItems,
} from '../adapters/rowAdapter'
import type {
  MessageListAdapter,
  MessageListFeedId,
  MessageListIdentityRemap,
  MessageListPage,
  MessageListRowsReplaceInput,
  MessageListScrollToMessageOptions,
  MessageListSessionId,
  MessageListSessionRegistryOptions,
} from '../contracts'

export type RuntimeNeedEvent = Extract<
  MessageListRuntimeEvent,
  { requestToken: string }
>

export type AroundRequestOptions = {
  align?: ResetAroundAlign
  offsetWithinMessage?: number
}

export type SessionDefaults = {
  pageSize: number
  maxItems: number
  keepAlive: {
    maxSessions: number
    ttlMs: number
  }
}

export type SessionOptions<Row, Feed = MessageListFeedId> = {
  id: MessageListSessionId
  feed: Feed
  adapter: MessageListAdapter<Row, Feed>
  defaults: SessionDefaults
  tailEvents?: MessageListSessionRegistryOptions<Row, Feed>['tailEvents']
  scrollMotion?: MessageListSessionRegistryOptions<Row, Feed>['scrollMotion']
  onRequestResult?: MessageListSessionRegistryOptions<Row, Feed>['onRequestResult']
}

export function toSessionResetInput<Row, Feed>(
  id: MessageListSessionId,
  page: MessageListPage<Row>,
  adapter: MessageListAdapter<Row, Feed>,
): ResetSegmentInput<Row, unknown> {
  return {
    items: toMessageDataItems(id, page.rows, adapter),
    hasMoreBefore: page.hasMoreBefore,
    hasMoreAfter: page.hasMoreAfter,
    anchor: page.anchor
      ? normalizeMessageListAnchor(id, page.anchor)
      : undefined,
    anchorStatus: page.anchorStatus,
  }
}

export function toSessionReplaceInput<Row, Feed>(
  id: MessageListSessionId,
  input: MessageListRowsReplaceInput<Row>,
  adapter: MessageListAdapter<Row, Feed>,
): ReplaceSegmentInput<Row, unknown> {
  return {
    items: toMessageDataItems(id, input.rows, adapter),
    changedKeys: input.changedKeys ??
      input.rows.map((row) => adapter.row.getKey(row)),
    hasMoreBefore: input.hasMoreBefore,
    hasMoreAfter: input.hasMoreAfter,
    anchor: input.anchor
      ? normalizeMessageListAnchor(id, input.anchor)
      : undefined,
    anchorStatus: input.anchorStatus,
  }
}

export function toSessionIdentityRemaps(
  id: MessageListSessionId,
  remaps: MessageListIdentityRemap[],
): IdentityRemapInput {
  return remaps.map((remap) => ({
    ...remap,
    from: normalizeMessageListAnchor(id, remap.from),
    to: normalizeMessageListAnchor(id, remap.to),
  }))
}

export function toRuntimeScrollOptions(
  id: MessageListSessionId,
  options: MessageListScrollToMessageOptions | undefined,
): RuntimeScrollToMessageOptions | undefined {
  if (!options) {
    return undefined
  }

  return {
    ...options,
    motion: options.motion
      ? {
          ...options.motion,
          origin: options.motion.origin
            ? normalizeMessageListAnchor(id, options.motion.origin)
            : undefined,
        }
      : undefined,
  }
}

export function reindexRows<Row>(
  rowsByKey: Map<string, Row>,
  items: MessageDataItem<Row>[],
): void {
  rowsByKey.clear()

  for (const item of items) {
    if (item.message !== undefined) {
      rowsByKey.set(item.key, item.message)
    }
  }
}

export function resolveTrimProtectKey<Row>(
  runtime: MessageListRuntime<Row>,
  dataRuntime: MessageListDataRuntime<Row>,
): string | undefined {
  const segment = dataRuntime.getSegment()

  if (runtime.getSnapshot().bottomLockState === 'LOCKED') {
    return segment.items.at(-1)?.key
  }

  const anchor = runtime.getViewportAnchor()

  if (!anchor) {
    return segment.items[Math.floor(segment.items.length / 2)]?.key
  }

  return segment.items.find((item) => {
    const identity = item.identity
    return identity && anchorsMatch(identity, anchor)
  })?.key
}

function anchorsMatch(
  identity: MessageDataItem['identity'],
  anchor: MessageIdentityAnchor,
): boolean {
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
