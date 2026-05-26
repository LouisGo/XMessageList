import type { MessageIdentityAnchor, MessageRuntimeItemKey } from './identity'
import type { LoadedSegment } from './segment'
import type { RuntimeObserverFactory } from './options'
import type {
  MessageListSnapshot,
  ProjectionCommitToken,
} from './snapshot'

export function createBrowserObserverFactory(): RuntimeObserverFactory | null {
  if (
    typeof ResizeObserver === 'undefined' ||
    typeof IntersectionObserver === 'undefined'
  ) {
    return null
  }

  return {
    createResizeObserver: (callback) => new ResizeObserver(callback),
    createIntersectionObserver: (callback, options) =>
      new IntersectionObserver(callback, options),
  }
}

export function createInitialSnapshot<TMessage, TOptimistic>(
  feedId: string,
): MessageListSnapshot<TMessage, TOptimistic> {
  const commitToken = {
    feedId,
    generation: 0,
    segmentRevision: 0,
    projectionRevision: 0,
  }
  return {
    ...commitToken,
    commitToken,
    items: [],
    segmentMeta: {
      hasMoreBefore: false,
      hasMoreAfter: false,
      modifier: { type: 'bootstrap' },
      shortSegmentAlignment: 'start',
      underflow: 'unknown',
    },
    edgeState: {
      before: { status: 'idle' },
      after: { status: 'idle' },
    },
    bottomLockState: 'UNLOCKED',
    pendingIntent: null,
    viewportPhase: 'IDLE',
  }
}

export function createSnapshotFromSegment<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  options: {
    previous: MessageListSnapshot<TMessage, TOptimistic>
    projectionRevision: number
    viewportPhase: MessageListSnapshot['viewportPhase']
  },
): MessageListSnapshot<TMessage, TOptimistic> {
  const commitToken = {
    feedId: segment.feedId,
    generation: segment.generation,
    segmentRevision: segment.segmentRevision,
    projectionRevision: options.projectionRevision,
  }
  return {
    ...options.previous,
    ...commitToken,
    commitToken,
    items: segment.items,
    segmentMeta: {
      hasMoreBefore: segment.hasMoreBefore,
      hasMoreAfter: segment.hasMoreAfter,
      modifier: segment.modifier,
      anchor: segment.anchor,
      anchorStatus: segment.anchorStatus,
      shortSegmentAlignment: resolveShortSegmentAlignment(segment, options.previous),
      underflow: 'unknown',
    },
    viewportPhase: options.viewportPhase,
  }
}

export function isSameToken(
  left: ProjectionCommitToken,
  right: ProjectionCommitToken,
): boolean {
  return left.feedId === right.feedId &&
    left.generation === right.generation &&
    left.segmentRevision === right.segmentRevision &&
    left.projectionRevision === right.projectionRevision
}

export function isSameSegmentToken(
  left: ProjectionCommitToken,
  right: ProjectionCommitToken,
): boolean {
  return left.feedId === right.feedId &&
    left.generation === right.generation &&
    left.segmentRevision === right.segmentRevision
}

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

function resolveShortSegmentAlignment<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  previous: MessageListSnapshot<TMessage, TOptimistic>,
): MessageListSnapshot['segmentMeta']['shortSegmentAlignment'] {
  if (
    previous.bottomLockState === 'LOCKED' ||
    segment.modifier.type === 'reset-latest'
  ) {
    return 'end'
  }

  if (segment.modifier.type === 'reset-around') {
    return 'center'
  }

  return 'start'
}
