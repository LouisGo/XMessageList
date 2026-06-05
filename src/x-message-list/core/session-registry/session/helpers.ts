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
  LoadedSegmentStore,
  ReplaceSegmentInput,
  ResetSegmentInput,
} from '../loaded-segment-store/index'
import {
  normalizeMessageListAnchor,
  toMessageDataItems,
} from '../adapters/rowAdapter'
import type {
  MessageListAdapter,
  MessageListIdentityRemap,
  MessageListPage,
  MessageListRowsReplaceInput,
  MessageListScrollToMessageOptions,
  MessageListSegmentRetention,
  MessageListSessionId,
  MessageListSessionSource,
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
  retention: MessageListSegmentRetention
  keepAlive: {
    maxSessions: number
    ttlMs: number
  }
}

export type SessionOptions<Row, Source = MessageListSessionSource> = {
  sessionId: MessageListSessionId
  source: Source
  adapter: MessageListAdapter<Row, Source>
  defaults: SessionDefaults
  tailEvents?: MessageListSessionRegistryOptions<Row, Source>['tailEvents']
  scrollMotion?: MessageListSessionRegistryOptions<Row, Source>['scrollMotion']
  onRequestResult?: MessageListSessionRegistryOptions<Row, Source>['onRequestResult']
}

const RETENTION_VIEWPORT_MULTIPLIER: Record<MessageListSegmentRetention, number> = {
  low: 4,
  balanced: 8,
  high: 14,
}

export type AdaptiveTrimBudgetInput = {
  pageSize: number
  retention: MessageListSegmentRetention
  rowsPerViewportEstimate: number
}

export function resolveAdaptiveTrimBudget(
  input: AdaptiveTrimBudgetInput,
): number {
  const rowsPerViewport = Math.max(1, Math.ceil(input.rowsPerViewportEstimate))
  const viewportBudget = rowsPerViewport *
    RETENTION_VIEWPORT_MULTIPLIER[input.retention]

  return Math.max(input.pageSize * 2, viewportBudget)
}

export function toSessionResetInput<Row, Source>(
  sessionId: MessageListSessionId,
  page: MessageListPage<Row>,
  adapter: MessageListAdapter<Row, Source>,
): ResetSegmentInput<Row, unknown> {
  return {
    items: toMessageDataItems(sessionId, page.rows, adapter),
    hasMoreBefore: page.hasMoreBefore,
    hasMoreAfter: page.hasMoreAfter,
    anchor: page.anchor
      ? normalizeMessageListAnchor(sessionId, page.anchor)
      : undefined,
    anchorStatus: page.anchorStatus,
  }
}

export function toSessionReplaceInput<Row, Source>(
  sessionId: MessageListSessionId,
  input: MessageListRowsReplaceInput<Row>,
  adapter: MessageListAdapter<Row, Source>,
): ReplaceSegmentInput<Row, unknown> {
  return {
    items: toMessageDataItems(sessionId, input.rows, adapter),
    changedKeys: input.changedKeys ??
      input.rows.map((row) => adapter.row.getKey(row)),
    hasMoreBefore: input.hasMoreBefore,
    hasMoreAfter: input.hasMoreAfter,
    anchor: input.anchor
      ? normalizeMessageListAnchor(sessionId, input.anchor)
      : undefined,
    anchorStatus: input.anchorStatus,
  }
}

export function toSessionIdentityRemaps(
  sessionId: MessageListSessionId,
  remaps: MessageListIdentityRemap[],
): IdentityRemapInput {
  return remaps.map((remap) => ({
    ...remap,
    from: normalizeMessageListAnchor(sessionId, remap.from),
    to: normalizeMessageListAnchor(sessionId, remap.to),
  }))
}

export function toRuntimeScrollOptions(
  sessionId: MessageListSessionId,
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
            ? normalizeMessageListAnchor(sessionId, options.motion.origin)
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
  loadedSegmentStore: LoadedSegmentStore<Row>,
): string | undefined {
  const segment = loadedSegmentStore.getSegment()

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
      identity.sessionId === anchor.sessionId &&
      (
        identity.stableId === anchor.stableId ||
        Boolean(identity.serverId && identity.serverId === anchor.serverId) ||
        Boolean(identity.localId && identity.localId === anchor.localId)
      ),
  )
}
