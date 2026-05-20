import type { MessageRuntimeItemKey } from '../../identity/types'
import type { MessageDataItem } from '../../projection/types'
import { resolvePhysicalSegmentConfig } from '../config/config'
import type { ResolvedPhysicalSegmentConfig } from '../config/config'
import { isMessageRuntimeItemKeyEqual } from './itemKey'
import type {
  PhysicalRowSelection,
  PhysicalRowSelectionDirectionHint,
  PhysicalRowSelectionInput,
} from './rowSelection.types'

type SelectionPlacement = 'start' | 'center' | 'end'

type MutableRange = {
  startIndex: number
  endIndex: number
  mountedRowsHeightEstimate: number
  itemCount: number
  beforeHeight: number
  afterHeight: number
}

export function selectPhysicalRows<TMessage = unknown, TOptimistic = unknown>(
  input: PhysicalRowSelectionInput<TMessage, TOptimistic>,
): PhysicalRowSelection {
  const config = resolvePhysicalSegmentConfig(input.config)
  const maxMountedHeight = resolveMaxMountedHeight(input, config)
  const maxMountedItems = resolveMaxMountedItems(config)
  const defaultEstimatedRowHeightPx = resolveDefaultEstimatedRowHeight(config)

  if (input.items.length === 0 || maxMountedHeight === 0 || maxMountedItems === 0) {
    return createEmptySelection()
  }

  const anchorIndex = resolveAnchorIndex(
    input.items,
    input.anchor?.key ?? null,
    input.directionHint,
  )
  const placement = resolvePlacement(input.directionHint)
  const rowHeights = input.items.map((item) =>
    estimateRowHeight(item, defaultEstimatedRowHeightPx))
  const range =
    placement === 'center'
      ? selectCenteredRange({
          anchorIndex,
          rowHeights,
          maxMountedHeight,
          maxMountedItems,
        })
      : selectDirectionalRange({
          anchorIndex,
          rowHeights,
          maxMountedHeight,
          maxMountedItems,
          placement,
        })

  if (range === null) {
    return createEmptySelection(anchorIndex)
  }

  const itemKeys = input.items
    .slice(range.startIndex, range.endIndex + 1)
    .map((item) => item.key)

  return {
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    itemKeys,
    mountedRowsHeightEstimate: range.mountedRowsHeightEstimate,
    anchorIndex,
  }
}

function selectDirectionalRange(input: {
  readonly anchorIndex: number
  readonly rowHeights: readonly number[]
  readonly maxMountedHeight: number
  readonly maxMountedItems: number
  readonly placement: SelectionPlacement
}): MutableRange | null {
  const anchorHeight = input.rowHeights[input.anchorIndex]

  if (anchorHeight === undefined || anchorHeight > input.maxMountedHeight) {
    return null
  }

  const range: MutableRange = {
    startIndex: input.anchorIndex,
    endIndex: input.anchorIndex,
    mountedRowsHeightEstimate: anchorHeight,
    itemCount: 1,
    beforeHeight: 0,
    afterHeight: 0,
  }
  const step = input.placement === 'start' ? 1 : -1

  while (range.itemCount < input.maxMountedItems) {
    const nextIndex = step > 0 ? range.endIndex + 1 : range.startIndex - 1
    const nextHeight = input.rowHeights[nextIndex]

    if (
      nextHeight === undefined ||
      range.mountedRowsHeightEstimate + nextHeight > input.maxMountedHeight
    ) {
      break
    }

    if (step > 0) {
      range.endIndex = nextIndex
      range.afterHeight += nextHeight
    } else {
      range.startIndex = nextIndex
      range.beforeHeight += nextHeight
    }
    range.mountedRowsHeightEstimate += nextHeight
    range.itemCount += 1
  }

  return range
}

function selectCenteredRange(input: {
  readonly anchorIndex: number
  readonly rowHeights: readonly number[]
  readonly maxMountedHeight: number
  readonly maxMountedItems: number
}): MutableRange | null {
  const anchorHeight = input.rowHeights[input.anchorIndex]

  if (anchorHeight === undefined || anchorHeight > input.maxMountedHeight) {
    return null
  }

  const range: MutableRange = {
    startIndex: input.anchorIndex,
    endIndex: input.anchorIndex,
    mountedRowsHeightEstimate: anchorHeight,
    itemCount: 1,
    beforeHeight: 0,
    afterHeight: 0,
  }

  while (range.itemCount < input.maxMountedItems) {
    const nextBefore = range.startIndex - 1
    const nextAfter = range.endIndex + 1
    const beforeFits = canAddRow(
      input.rowHeights[nextBefore],
      range.mountedRowsHeightEstimate,
      input.maxMountedHeight,
    )
    const afterFits = canAddRow(
      input.rowHeights[nextAfter],
      range.mountedRowsHeightEstimate,
      input.maxMountedHeight,
    )

    if (!beforeFits && !afterFits) {
      break
    }

    if (beforeFits && (!afterFits || range.beforeHeight <= range.afterHeight)) {
      const nextHeight = input.rowHeights[nextBefore] as number
      range.startIndex = nextBefore
      range.beforeHeight += nextHeight
      range.mountedRowsHeightEstimate += nextHeight
    } else {
      const nextHeight = input.rowHeights[nextAfter] as number
      range.endIndex = nextAfter
      range.afterHeight += nextHeight
      range.mountedRowsHeightEstimate += nextHeight
    }
    range.itemCount += 1
  }

  return range
}

function canAddRow(
  height: number | undefined,
  currentHeight: number,
  maxMountedHeight: number,
): boolean {
  return height !== undefined && currentHeight + height <= maxMountedHeight
}

function resolveAnchorIndex<TMessage, TOptimistic>(
  items: readonly MessageDataItem<TMessage, TOptimistic>[],
  anchorKey: MessageRuntimeItemKey | null,
  directionHint: PhysicalRowSelectionDirectionHint | undefined,
): number {
  if (anchorKey !== null) {
    const index = items.findIndex((item) =>
      isMessageRuntimeItemKeyEqual(item.key, anchorKey),
    )

    if (index >= 0) {
      return index
    }
  }

  switch (directionHint) {
    case 'latest':
    case 'after':
      return items.length - 1
    case 'target':
      return Math.floor((items.length - 1) / 2)
    case 'before':
    default:
      return 0
  }
}

function resolvePlacement(
  directionHint: PhysicalRowSelectionDirectionHint | undefined,
): SelectionPlacement {
  switch (directionHint) {
    case 'latest':
    case 'after':
      return 'end'
    case 'target':
      return 'center'
    case 'before':
    default:
      return 'start'
  }
}

function resolveMaxMountedHeight<TMessage, TOptimistic>(
  input: PhysicalRowSelectionInput<TMessage, TOptimistic>,
  config: ResolvedPhysicalSegmentConfig,
): number {
  const maxMountedHeight =
    input.maxMountedHeight ??
    (
      input.physicalWindowHeight === undefined
        ? undefined
        : input.physicalWindowHeight - config.minimumSafeBufferPx
    )

  if (maxMountedHeight === undefined) {
    throw new RangeError(
      'row selection requires maxMountedHeight or physicalWindowHeight',
    )
  }

  if (!Number.isFinite(maxMountedHeight) || maxMountedHeight < 0) {
    throw new RangeError('row selection maxMountedHeight must be non-negative')
  }

  return maxMountedHeight
}

function resolveMaxMountedItems(
  config: ResolvedPhysicalSegmentConfig,
): number {
  if (!Number.isInteger(config.maxMountedItems) || config.maxMountedItems < 0) {
    throw new RangeError('row selection maxMountedItems must be non-negative')
  }

  return config.maxMountedItems
}

function resolveDefaultEstimatedRowHeight(
  config: ResolvedPhysicalSegmentConfig,
): number {
  if (
    !Number.isFinite(config.defaultEstimatedRowHeightPx) ||
    config.defaultEstimatedRowHeightPx <= 0
  ) {
    throw new RangeError(
      'defaultEstimatedRowHeightPx must be a positive number',
    )
  }

  return config.defaultEstimatedRowHeightPx
}

function estimateRowHeight<TMessage, TOptimistic>(
  item: MessageDataItem<TMessage, TOptimistic>,
  defaultEstimatedRowHeightPx: number,
): number {
  return item.estimatedHeight !== undefined &&
    Number.isFinite(item.estimatedHeight) &&
    item.estimatedHeight > 0
    ? item.estimatedHeight
    : defaultEstimatedRowHeightPx
}

function createEmptySelection(anchorIndex: number | null = null): PhysicalRowSelection {
  return {
    startIndex: 0,
    endIndex: -1,
    itemKeys: [],
    mountedRowsHeightEstimate: 0,
    anchorIndex,
  }
}
