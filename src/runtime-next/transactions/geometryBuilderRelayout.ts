import type { MessageDataSnapshot } from '../data/types'
import type { MessageRuntimeItemKey } from '../identity/types'
import { isMessageRuntimeItemKeyEqual } from '../identity/itemKey'
import type { MessageDataItem } from '../projection/types'
import type { GeometryBuildInput } from './geometryBuilder.types'

export type GeometryRelayoutBoundsFailureReason =
  | 'logical-bounds-missing'
  | 'logical-bounds-reversed'

export class GeometryRelayoutBoundsError extends Error {
  readonly reason: GeometryRelayoutBoundsFailureReason
  readonly anchorKey: MessageRuntimeItemKey

  constructor(input: {
    readonly reason: GeometryRelayoutBoundsFailureReason
    readonly anchorKey: MessageRuntimeItemKey
  }) {
    super(`segmentRelayout cannot recover current logical bounds: ${input.reason}`)
    this.name = 'GeometryRelayoutBoundsError'
    this.reason = input.reason
    this.anchorKey = input.anchorKey
  }
}

export class GeometrySegmentShiftBoundsError extends Error {
  readonly direction: 'before' | 'after'
  readonly reason: 'missing-current-segment' | 'missing-target-data' | 'edge-exhausted'

  constructor(input: {
    readonly direction: 'before' | 'after'
    readonly reason: 'missing-current-segment' | 'missing-target-data' | 'edge-exhausted'
  }) {
    super(`segmentShift cannot build adjacent segment: ${input.reason}`)
    this.name = 'GeometrySegmentShiftBoundsError'
    this.direction = input.direction
    this.reason = input.reason
  }
}

export function resolveGeometryCandidateItems<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  input: GeometryBuildInput<TMessage, TOptimistic>,
): readonly MessageDataItem<TMessage, TOptimistic>[] {
  const current = input.currentSegment
  if (input.kind === 'segmentShift') {
    if (current === undefined) {
      throw new GeometrySegmentShiftBoundsError({
        direction: input.direction ?? 'after',
        reason: 'missing-current-segment',
      })
    }

    return sliceAdjacentShiftItems(input, current)
  }
  if (input.kind !== 'segmentRelayout' || current === undefined) {
    return input.data.items
  }

  return sliceItemsBetweenKeys(
    input.data,
    current.logicalStartItemKey,
    current.logicalEndItemKey,
    current.logicalAnchorKey,
  )
}

function sliceAdjacentShiftItems<TMessage, TOptimistic>(
  input: GeometryBuildInput<TMessage, TOptimistic>,
  current: NonNullable<GeometryBuildInput<TMessage, TOptimistic>['currentSegment']>,
): readonly MessageDataItem<TMessage, TOptimistic>[] {
  const direction = input.direction ?? 'after'
  const startIndex = input.data.items.findIndex((item) =>
    isMessageRuntimeItemKeyEqual(item.key, current.logicalStartItemKey),
  )
  const endIndex = input.data.items.findIndex((item) =>
    isMessageRuntimeItemKeyEqual(item.key, current.logicalEndItemKey),
  )

  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new GeometrySegmentShiftBoundsError({
      direction,
      reason: 'missing-target-data',
    })
  }

  if (direction === 'before') {
    if (startIndex <= 0) {
      throw new GeometrySegmentShiftBoundsError({
        direction,
        reason: input.data.hasMoreBefore ? 'missing-target-data' : 'edge-exhausted',
      })
    }

    return input.data.items.slice(0, startIndex)
  }

  if (endIndex >= input.data.items.length - 1) {
    throw new GeometrySegmentShiftBoundsError({
      direction,
      reason: input.data.hasMoreAfter ? 'missing-target-data' : 'edge-exhausted',
    })
  }

  return input.data.items.slice(endIndex + 1)
}

export function resolveRelayoutAnchor(
  input: GeometryBuildInput,
): MessageRuntimeItemKey | null {
  if (input.kind !== 'segmentRelayout') {
    return null
  }

  return input.currentSegment?.logicalAnchorKey ?? null
}

function sliceItemsBetweenKeys<TMessage, TOptimistic>(
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  startKey: MessageRuntimeItemKey,
  endKey: MessageRuntimeItemKey,
  anchorKey: MessageRuntimeItemKey,
): readonly MessageDataItem<TMessage, TOptimistic>[] {
  const startIndex = data.items.findIndex((item) =>
    isMessageRuntimeItemKeyEqual(item.key, startKey),
  )
  const endIndex = data.items.findIndex((item) =>
    isMessageRuntimeItemKeyEqual(item.key, endKey),
  )

  if (startIndex < 0 || endIndex < 0) {
    throw new GeometryRelayoutBoundsError({
      reason: 'logical-bounds-missing',
      anchorKey,
    })
  }

  if (endIndex < startIndex) {
    throw new GeometryRelayoutBoundsError({
      reason: 'logical-bounds-reversed',
      anchorKey,
    })
  }

  return data.items.slice(startIndex, endIndex + 1)
}
