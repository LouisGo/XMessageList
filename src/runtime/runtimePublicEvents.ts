import { findKeyForAnchor } from './controllerHelpers'
import type {
  DestinationSettledEvent,
  SegmentTrimPressureEvent,
  ViewportObservationActivity,
  ViewportObservationChangedEvent,
  ViewportObservationReason,
  ViewportScrollDirection,
} from './events'
import type { MessageIdentityAnchor } from './identity'
import type { DestinationIntent } from './interactionTypes'
import type { RuntimeMeasurement } from './measurement'
import type { LoadedSegment } from './segment'
import type { ScrollSource } from './scrollIntentEngine'
import type { MessageListSnapshot } from './snapshot'
import type { ResolvedViewportAnchor } from './viewportAnchorEvents'

export function createViewportObservationEvent<TMessage, TOptimistic>(input: {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  measurement: RuntimeMeasurement
  reason: ViewportObservationReason
  scrollSource: ScrollSource | null
  previousScrollTop: number
  anchor: ResolvedViewportAnchor
}): ViewportObservationChangedEvent {
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
    feedId: input.snapshot.feedId,
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
  const resolution = input.resolvedTarget &&
    isSameAnchorIdentity(input.destination.target, input.resolvedTarget)
    ? 'target'
    : 'fallback'

  return {
    type: 'destinationSettled',
    feedId: input.snapshot.feedId,
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
}): SegmentTrimPressureEvent | null {
  if (
    input.segment.items.length === 0 ||
    input.segment.modifier.type === 'trim-before' ||
    input.segment.modifier.type === 'trim-after'
  ) {
    return null
  }

  return {
    type: 'segmentTrimPressure',
    feedId: input.snapshot.feedId,
    generation: input.snapshot.generation,
    segmentRevision: input.snapshot.segmentRevision,
    itemCount: input.segment.items.length,
    anchor: input.anchor,
    preferredTrimSide: resolvePreferredTrimSide(input.snapshot, input.anchor),
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
    return index <= (snapshot.items.length - 1) / 2 ? 'after' : 'before'
  }

  return snapshot.bottomLockState === 'LOCKED' ? 'before' : 'after'
}

function isSameAnchorIdentity(
  left: MessageIdentityAnchor,
  right: MessageIdentityAnchor,
): boolean {
  return left.feedId === right.feedId &&
    (
      Boolean(left.serverId && left.serverId === right.serverId) ||
      left.stableId === right.stableId ||
      Boolean(left.localId && left.localId === right.localId)
    )
}
