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
  sessionId: string,
): MessageListSnapshot<TMessage, TOptimistic> {
  // 初始 commitToken 是空投影基线；后续 segment projection 会递增 projectionRevision。
  const commitToken = {
    sessionId,
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
      context: 'latest',
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
    sessionId: segment.sessionId,
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
      context: segment.context,
      modifier: segment.modifier,
      ...(segment.effects?.length ? { effects: segment.effects } : {}),
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
  return left.sessionId === right.sessionId &&
    left.generation === right.generation &&
    left.segmentRevision === right.segmentRevision &&
    left.projectionRevision === right.projectionRevision
}

export function isSameSegmentToken(
  left: ProjectionCommitToken,
  right: ProjectionCommitToken,
): boolean {
  return left.sessionId === right.sessionId &&
    left.generation === right.generation &&
    left.segmentRevision === right.segmentRevision
}

function resolveShortSegmentAlignment<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  previous: MessageListSnapshot<TMessage, TOptimistic>,
): MessageListSnapshot['segmentMeta']['shortSegmentAlignment'] {
  if (segment.modifier.type === 'reset-around') {
    // 短窗口没有额外 native scroll range 时，offset 无法靠 scrollTop 表达；此处仍应
    // 让整个 segment 遵守 reset 的显式布局意图，而不是回退到 jump 的默认居中。
    if (
      segment.modifier.align === 'start' ||
      segment.modifier.offsetWithinMessage !== undefined
    ) {
      return 'start'
    }
    if (segment.modifier.align === 'end') return 'end'
    return 'center'
  }

  if (
    previous.bottomLockState === 'LOCKED' ||
    segment.modifier.type === 'reset-latest'
  ) {
    // latest/bottom-lock 短窗口要贴底，避免首屏短内容停在顶部。
    return 'end'
  }

  return 'start'
}
