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

export function resolveGeometryCandidateItems<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  input: GeometryBuildInput<TMessage, TOptimistic>,
): readonly MessageDataItem<TMessage, TOptimistic>[] {
  const current = input.currentSegment
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
