import type { MessageIdentityAnchor, MessageRuntimeItemKey } from '../contracts/identity'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'

export function withNextProjectionRevision<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
): MessageListSnapshot<TMessage, TOptimistic> {
  const projectionRevision = snapshot.projectionRevision + 1
  const commitToken = {
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    segmentRevision: snapshot.segmentRevision,
    projectionRevision,
  }

  return {
    ...snapshot,
    ...commitToken,
    commitToken,
  }
}

export function resolveRemappedAnchorKey<TMessage, TOptimistic>(
  key: MessageRuntimeItemKey,
  segment: LoadedSegment<TMessage, TOptimistic>,
): MessageRuntimeItemKey {
  if (segment.modifier.type !== 'identity-remap') {
    return key
  }

  const remap = segment.modifier.remaps.find((candidate) =>
    candidate.previousKey === key || candidate.nextKey === key
  )

  return remap?.nextKey ?? key
}

export function resolveAnchorFromKey<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  key: MessageRuntimeItemKey,
): MessageIdentityAnchor | null {
  return resolveAnchorFromItems(segment.items, key)
}

export function resolveAnchorFromSnapshot<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  key: MessageRuntimeItemKey,
): MessageIdentityAnchor | null {
  return resolveAnchorFromItems(snapshot.items, key)
}

export function findKeyForAnchor<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  anchor: MessageIdentityAnchor,
): MessageRuntimeItemKey | null {
  const item = snapshot.items.find((candidate) => {
    const identity = candidate.identity

    return identity &&
      identity.feedId === anchor.feedId &&
      (
        identity.stableId === anchor.stableId ||
        Boolean(identity.serverId && identity.serverId === anchor.serverId) ||
        Boolean(identity.localId && identity.localId === anchor.localId)
      )
  })

  return item?.key ?? null
}

function resolveAnchorFromItems<TMessage, TOptimistic>(
  items: LoadedSegment<TMessage, TOptimistic>['items'],
  key: MessageRuntimeItemKey,
): MessageIdentityAnchor | null {
  const item = items.find((candidate) => candidate.key === key)

  if (!item?.identity) {
    return null
  }

  return {
    feedId: item.identity.feedId,
    stableId: item.identity.stableId,
    serverId: item.identity.serverId,
    localId: item.identity.localId,
  }
}
