import type { LoadedSegment } from '../contracts/segment'
import type { RuntimeObserverFactory } from '../contracts/options'
import type {
  MessageListSnapshot,
  ProjectionCommitToken,
} from '../contracts/snapshot'

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
