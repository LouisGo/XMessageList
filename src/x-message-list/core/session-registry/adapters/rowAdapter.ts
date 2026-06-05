import type {
  MessageDataItem,
  MessageIdentity,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../../runtime/index'
import type {
  MessageListAdapter,
  MessageListAnchor,
  MessageListSessionId,
} from '../contracts'

export function toMessageDataItems<Row, Source>(
  sessionId: MessageListSessionId,
  rows: Row[],
  adapter: MessageListAdapter<Row, Source>,
): MessageDataItem<Row>[] {
  return rows.map((row) => {
    const anchor = adapter.row.getAnchor(row)
    const key = adapter.row.getKey(row)
    const version = adapter.row.getVersion?.(row)
    const rowKind = adapter.row.getKind?.(row) ?? 'message'

    return {
      key,
      rowKind: toRuntimeRowKind(rowKind),
      identity: anchor
        ? toMessageIdentity(
            sessionId,
            normalizeMessageListAnchor(sessionId, anchor),
            version,
          )
        : undefined,
      renderVersion: toRenderVersion(version),
      message: row,
    }
  })
}

export function resolveRowsByKeys<Row>(
  items: MessageDataItem<Row>[],
  keys: MessageRuntimeItemKey[],
): Row[] {
  const rows: Row[] = []
  const itemsByKey = new Map(items.map((item) => [item.key, item]))

  for (const key of keys) {
    const row = itemsByKey.get(key)?.message

    if (row !== undefined) {
      rows.push(row)
    }
  }

  return rows
}

export function normalizeMessageListAnchor(
  sessionId: MessageListSessionId,
  anchor: MessageListAnchor,
): MessageIdentityAnchor {
  const stableId = anchor.stableId ??
    anchor.serverId ??
    anchor.localId ??
    anchor.id ??
    ''

  return {
    sessionId: anchor.sessionId ?? sessionId,
    stableId,
    serverId: anchor.serverId ?? anchor.id,
    localId: anchor.localId,
    fallbackStableId: anchor.fallbackStableId,
    fallbackReason: anchor.fallbackReason,
  }
}

function toMessageIdentity(
  sessionId: MessageListSessionId,
  anchor: MessageIdentityAnchor,
  version: unknown,
): MessageIdentity {
  return {
    sessionId: anchor.sessionId ?? sessionId,
    stableId: anchor.stableId,
    serverId: anchor.serverId,
    localId: anchor.localId,
    version: toRenderVersion(version),
  }
}

function toRenderVersion(version: unknown): number {
  return typeof version === 'number' && Number.isFinite(version)
    ? version
    : 0
}

function toRuntimeRowKind(
  rowKind: string,
): MessageDataItem['rowKind'] {
  if (
    rowKind === 'message' ||
    rowKind === 'date-separator' ||
    rowKind === 'system' ||
    rowKind === 'deleted-placeholder' ||
    rowKind === 'permission-fallback'
  ) {
    return rowKind
  }

  return 'message'
}
