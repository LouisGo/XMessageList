import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../identity'
import type { IdentityRemapInput } from './dataRuntime'

export function mergeBeforeItems<TMessage, TOptimistic>(
  incoming: MessageDataItem<TMessage, TOptimistic>[],
  current: MessageDataItem<TMessage, TOptimistic>[],
): MessageDataItem<TMessage, TOptimistic>[] {
  return dedupeItems([...incoming, ...current])
}

export function mergeAfterItems<TMessage, TOptimistic>(
  current: MessageDataItem<TMessage, TOptimistic>[],
  incoming: MessageDataItem<TMessage, TOptimistic>[],
): MessageDataItem<TMessage, TOptimistic>[] {
  return dedupeItems([...current, ...incoming])
}

export function dedupeItems<TMessage, TOptimistic>(
  items: MessageDataItem<TMessage, TOptimistic>[],
): MessageDataItem<TMessage, TOptimistic>[] {
  const seenKeys = new Set<MessageRuntimeItemKey>()
  const seenIdentities = new Set<string>()
  const next: MessageDataItem<TMessage, TOptimistic>[] = []

  for (const item of items) {
    const identityKey = item.identity ? serializeIdentity(item.identity) : null

    if (seenKeys.has(item.key) || (identityKey && seenIdentities.has(identityKey))) {
      continue
    }

    seenKeys.add(item.key)
    if (identityKey) {
      seenIdentities.add(identityKey)
    }
    next.push(item)
  }

  return next
}

export function patchSegmentItems<TMessage, TOptimistic>(
  current: MessageDataItem<TMessage, TOptimistic>[],
  patches: MessageDataItem<TMessage, TOptimistic>[],
): MessageDataItem<TMessage, TOptimistic>[] {
  const patchesByKey = new Map(patches.map((item) => [item.key, item]))
  const patchedKeys = new Set<MessageRuntimeItemKey>()
  const next = current.map((item) => {
    const patch = patchesByKey.get(item.key)

    if (!patch) {
      return item
    }

    patchedKeys.add(item.key)
    return patch
  })

  for (const patch of patches) {
    if (!patchedKeys.has(patch.key)) {
      next.push(patch)
    }
  }

  return dedupeItems(next)
}

export function applyIdentityRemaps<TMessage, TOptimistic>(
  items: MessageDataItem<TMessage, TOptimistic>[],
  remaps: IdentityRemapInput,
): MessageDataItem<TMessage, TOptimistic>[] {
  const remapByPreviousKey = new Map(
    remaps
      .filter((remap) => remap.previousKey)
      .map((remap) => [remap.previousKey as MessageRuntimeItemKey, remap]),
  )

  return dedupeItems(items.map((item) => {
    const remap = remapByPreviousKey.get(item.key) ??
      remaps.find((candidate) => matchesAnchor(item.identity, candidate.from))

    if (!remap) {
      return item
    }

    return {
      ...item,
      key: remap.nextKey,
      identity: {
        feedId: remap.to.feedId,
        stableId: remap.to.stableId,
        serverId: remap.to.serverId,
        localId: remap.to.localId,
        version: (item.identity?.version ?? 0) + 1,
      },
    }
  }))
}

export function trimAroundKey<TMessage, TOptimistic>(
  items: MessageDataItem<TMessage, TOptimistic>[],
  budget: number,
  protectKey?: MessageRuntimeItemKey,
): {
  items: MessageDataItem<TMessage, TOptimistic>[]
  removedBefore: number
  removedAfter: number
} {
  const safeBudget = Math.max(1, budget)
  const anchorIndex = resolveProtectIndex(items, protectKey)
  const overflow = Math.max(0, items.length - safeBudget)
  const beforeCount = anchorIndex
  const afterCount = items.length - anchorIndex - 1
  const trimBefore = beforeCount >= afterCount
  const removedBefore = trimBefore
    ? Math.min(overflow, beforeCount)
    : 0
  const removedAfter = trimBefore
    ? 0
    : Math.min(overflow, afterCount)
  const start = removedBefore
  const end = items.length - removedAfter

  return {
    items: items.slice(start, end),
    removedBefore,
    removedAfter,
  }
}

function resolveProtectIndex<TMessage, TOptimistic>(
  items: MessageDataItem<TMessage, TOptimistic>[],
  protectKey?: MessageRuntimeItemKey,
): number {
  if (!protectKey) {
    return 0
  }

  const index = items.findIndex((item) => item.key === protectKey)
  return index >= 0 ? index : 0
}

function serializeIdentity(identity: {
  feedId: string
  stableId: string
  serverId?: string
  localId?: string
}): string {
  if (identity.serverId) {
    return `${identity.feedId}|server:${identity.serverId}`
  }

  return [
    identity.feedId,
    `stable:${identity.stableId}`,
    identity.localId ? `local:${identity.localId}` : '',
  ].filter(Boolean).join('|')
}

function matchesAnchor(
  identity: MessageDataItem['identity'],
  anchor: MessageIdentityAnchor,
): boolean {
  return Boolean(
    identity &&
      identity.feedId === anchor.feedId &&
      (
        identity.stableId === anchor.stableId ||
        (identity.serverId && identity.serverId === anchor.serverId) ||
        (identity.localId && identity.localId === anchor.localId)
      ),
  )
}
