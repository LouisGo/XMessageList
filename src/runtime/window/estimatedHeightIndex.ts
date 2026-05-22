import type { MessageDataItem } from '../types'
import type { SpacerEngine } from './spacerEngine'

export function findEstimatedPrefixIndex(
  prefix: readonly number[],
  targetOffset: number,
): number {
  let left = 0
  let right = prefix.length - 1

  while (left < right) {
    const mid = Math.floor((left + right) / 2)

    if ((prefix[mid] ?? 0) >= targetOffset) {
      right = mid
    } else {
      left = mid + 1
    }
  }

  return left
}

export function buildEstimatedHeightPrefix(
  items: readonly MessageDataItem[],
  width: number,
  spacer: SpacerEngine,
): number[] {
  const prefix: number[] = []
  let height = 0

  for (const item of items) {
    height += spacer.estimateItemHeight(item, width)
    prefix.push(height)
  }

  return prefix
}
