import { findKeyForAnchor } from '../shared/snapshotIdentity'
import type {
  DestinationSettledEvent,
  SegmentTrimPressureEvent,
  ViewportObservationActivity,
  ViewportObservationChangedEvent,
  ViewportObservationReason,
  ViewportScrollDirection,
} from '../contracts/events'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { DestinationIntent } from '../state/interactionTypes'
import type { RuntimeMeasurement } from '../dom/measurement'
import type { LoadedSegment } from '../contracts/segment'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { ResolvedViewportAnchor } from '../dom/viewportAnchorEvents'

export function createViewportObservationEvent<TMessage, TOptimistic>(input: {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  measurement: RuntimeMeasurement
  reason: ViewportObservationReason
  scrollSource: ScrollSource | null
  previousScrollTop: number
  anchor: ResolvedViewportAnchor
}): ViewportObservationChangedEvent {
  // clientHeight 为 0 通常表示测试/未布局环境，此时保留测量行用于断言，不按可见比例过滤。
  const visibleItems = input.measurement.clientHeight === 0
    ? input.measurement.visibleRows.map((row) => ({
        key: row.key,
        visibleRatio: 1,
      }))
    : input.measurement.visibleRows
        .map((row) => ({
          key: row.key,
          visibleRatio: resolveVisibleRatio(
            row.top,
            row.bottom,
            input.measurement.viewportTop,
            input.measurement.viewportBottom,
          ),
        }))
        .filter((item) => item.visibleRatio > 0)

  return {
    type: 'viewportObservationChanged',
    sessionId: input.snapshot.sessionId,
    generation: input.snapshot.generation,
    segmentRevision: input.snapshot.segmentRevision,
    reason: input.reason,
    scrollSource: input.scrollSource,
    direction: resolveScrollDirection(
      input.previousScrollTop,
      input.measurement.scrollTop,
    ),
    activity: resolveActivity(input.reason),
    anchor: input.anchor.anchor,
    offsetWithinMessage: input.anchor.offsetWithinMessage,
    visibleRange: {
      firstKey: visibleItems[0]?.key ?? null,
      lastKey: visibleItems.at(-1)?.key ?? null,
    },
    visibleItems,
    visibleKeys: visibleItems.map((item) => item.key),
  }
}

export function createDestinationSettledEvent<TMessage, TOptimistic>(input: {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  destination: DestinationIntent
  resolvedTarget: MessageIdentityAnchor | null
}): DestinationSettledEvent {
  // deleted/unavailable 等 fallback 也会 settle，但 resolution 必须暴露是否命中原始目标。
  const resolution = input.resolvedTarget &&
    isSameAnchorIdentity(input.destination.target, input.resolvedTarget)
    ? 'target'
    : 'fallback'

  return {
    type: 'destinationSettled',
    sessionId: input.snapshot.sessionId,
    generation: input.snapshot.generation,
    segmentRevision: input.snapshot.segmentRevision,
    intent: input.destination.reason,
    target: input.destination.target,
    resolution,
    resolvedTarget: input.resolvedTarget ?? undefined,
  }
}

export function createSegmentTrimPressureEvent<TMessage, TOptimistic>(input: {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  segment: LoadedSegment<TMessage, TOptimistic>
  anchor: MessageIdentityAnchor | null
  measurement: RuntimeMeasurement
}): SegmentTrimPressureEvent | null {
  if (
    input.segment.items.length === 0
  ) {
    return null
  }

  const anchorKey = input.anchor
    ? findKeyForAnchor(input.snapshot, input.anchor)
    : null
  const anchorIndex = anchorKey
    ? input.snapshot.items.findIndex((item) => item.key === anchorKey)
    : -1
  const distances = resolveAnchorDistances(input.measurement, anchorKey)

  return {
    type: 'segmentTrimPressure',
    sessionId: input.snapshot.sessionId,
    generation: input.snapshot.generation,
    segmentRevision: input.snapshot.segmentRevision,
    itemCount: input.segment.items.length,
    anchor: input.anchor,
    anchorKey,
    itemsBeforeAnchor: anchorIndex >= 0 ? anchorIndex : 0,
    itemsAfterAnchor: anchorIndex >= 0
      ? Math.max(0, input.snapshot.items.length - anchorIndex - 1)
      : 0,
    distanceBeforeAnchorPx: distances.before,
    distanceAfterAnchorPx: distances.after,
    estimatedDomCost: input.segment.items.length,
    preferredTrimSide: resolvePreferredTrimSide(input.snapshot, input.anchor),
  }
}

function resolveAnchorDistances(
  measurement: RuntimeMeasurement,
  anchorKey: string | null,
): { before: number | null; after: number | null } {
  if (!anchorKey || measurement.visibleRows.length === 0) {
    return { before: null, after: null }
  }

  const anchorRow = measurement.visibleRows.find((row) => row.key === anchorKey)
  const first = measurement.visibleRows[0]
  const last = measurement.visibleRows.at(-1)

  if (!anchorRow || !first || !last) {
    return { before: null, after: null }
  }

  return {
    before: Math.max(0, anchorRow.top - first.top),
    after: Math.max(0, last.bottom - anchorRow.bottom),
  }
}

function resolveVisibleRatio(
  rowTop: number,
  rowBottom: number,
  viewportTop: number,
  viewportBottom: number,
): number {
  const rowHeight = Math.max(0, rowBottom - rowTop)

  if (rowHeight === 0) {
    return 0
  }

  const visibleHeight = Math.max(
    0,
    Math.min(rowBottom, viewportBottom) - Math.max(rowTop, viewportTop),
  )
  return Math.min(1, visibleHeight / rowHeight)
}

function resolveScrollDirection(
  previousScrollTop: number,
  nextScrollTop: number,
): ViewportScrollDirection {
  if (nextScrollTop > previousScrollTop) {
    return 'down'
  }

  if (nextScrollTop < previousScrollTop) {
    return 'up'
  }

  return 'none'
}

function resolveActivity(
  reason: ViewportObservationReason,
): ViewportObservationActivity {
  if (reason === 'scroll-idle') {
    return 'scrolling'
  }

  if (reason === 'resize') {
    return 'resizing'
  }

  if (reason === 'detach') {
    return 'detached'
  }

  return 'settling'
}

function resolvePreferredTrimSide<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  anchor: MessageIdentityAnchor | null,
): 'before' | 'after' {
  const key = anchor ? findKeyForAnchor(snapshot, anchor) : null
  const index = key
    ? snapshot.items.findIndex((item) => item.key === key)
    : -1

  if (index >= 0) {
    // 优先裁剪离 anchor 更远的一侧，降低后续锚点恢复失败概率。
    return index <= (snapshot.items.length - 1) / 2 ? 'after' : 'before'
  }

  return snapshot.bottomLockState === 'LOCKED' ? 'before' : 'after'
}

function isSameAnchorIdentity(
  left: MessageIdentityAnchor,
  right: MessageIdentityAnchor,
): boolean {
  return left.sessionId === right.sessionId &&
    (
      Boolean(left.serverId && left.serverId === right.serverId) ||
      left.stableId === right.stableId ||
      Boolean(left.localId && left.localId === right.localId)
    )
}
