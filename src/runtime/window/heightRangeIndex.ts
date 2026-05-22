import type { MessageDataItem } from '../types'

export type HeightRangeEstimator = (
  item: MessageDataItem,
  width: number,
) => number

/**
 * HeightRangeIndex 是单个 DataSnapshot + width bucket 下的估算前缀索引。
 * 它只服务 spacer/window 的派生计算，不成为跨 transaction 的权威物理坐标。
 */
export class HeightRangeIndex {
  private readonly prefix: number[] = []

  constructor(
    items: readonly MessageDataItem[],
    width: number,
    estimateItemHeight: HeightRangeEstimator,
  ) {
    let height = 0

    for (const item of items) {
      height += estimateItemHeight(item, width)
      this.prefix.push(height)
    }
  }

  estimateRangeHeight(startIndex: number, endIndex: number): number {
    const safeStart = Math.max(0, Math.min(this.prefix.length, startIndex))
    const safeEnd = Math.max(safeStart, Math.min(this.prefix.length, endIndex))

    if (safeStart >= safeEnd) {
      return 0
    }

    const before = safeStart > 0 ? this.prefix[safeStart - 1] ?? 0 : 0
    const end = this.prefix[safeEnd - 1] ?? before
    return Math.max(0, end - before)
  }

  findIndexAtOffset(offsetPx: number): number {
    if (this.prefix.length === 0) {
      return -1
    }

    const targetOffset = Math.max(0, offsetPx)
    let left = 0
    let right = this.prefix.length - 1

    while (left < right) {
      const mid = Math.floor((left + right) / 2)

      if ((this.prefix[mid] ?? 0) >= targetOffset) {
        right = mid
      } else {
        left = mid + 1
      }
    }

    return left
  }
}
