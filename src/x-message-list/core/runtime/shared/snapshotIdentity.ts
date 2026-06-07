import type { MessageIdentityAnchor, MessageRuntimeItemKey } from '../contracts/identity'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'

// interaction-only snapshot 变更也要递增 projectionRevision，确保 React adapter 收到新 commitToken。
export function withNextProjectionRevision<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
): MessageListSnapshot<TMessage, TOptimistic> {
  const projectionRevision = snapshot.projectionRevision + 1
  const commitToken = {
    sessionId: snapshot.sessionId,
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

  // optimistic -> confirmed remap 后，旧 visual anchor 需要落到 nextKey 才能继续修正。
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
      identity.sessionId === anchor.sessionId &&
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
    sessionId: item.identity.sessionId,
    stableId: item.identity.stableId,
    serverId: item.identity.serverId,
    localId: item.identity.localId,
  }
}
