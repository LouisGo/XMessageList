import type {
  HeightRecord,
  MessageDataItem,
  MessageRuntimeItemKey,
  WindowConfig,
} from '../types'
import {
  getItemEstimatedHeight,
  getRuntimeItemKey,
  getWidthBucket,
  serializeRuntimeItemKey,
} from '../shared/utils'

export type HeightCache = Map<string, HeightRecord>

/**
 * SpacerEngine 只做“局部估算 + 实测修正”，不建立全局精确 offset。
 * 这符合 IM runtime 的锚点模型：spacer 用来维持连续感，不是权威坐标。
 */
export class SpacerEngine {
  private rangeHeightCache = new WeakMap<MessageDataItem[], Map<string, number>>()

  constructor(
    private readonly config: WindowConfig,
    private readonly heightCache: HeightCache,
  ) {}

  invalidateEstimateCache(): void {
    this.rangeHeightCache = new WeakMap()
  }

  estimateItemHeight(item: MessageDataItem, width: number): number {
    const key = serializeRuntimeItemKey(getRuntimeItemKey(item))
    const cached = this.heightCache.get(key)

    if (cached && cached.widthBucket === getWidthBucket(width)) {
      return cached.height
    }

    return getItemEstimatedHeight(item) ?? this.config.defaultItemHeight
  }

  estimateKeyHeight(key: MessageRuntimeItemKey): number {
    const cached = this.heightCache.get(serializeRuntimeItemKey(key))
    return cached?.height ?? this.config.defaultItemHeight
  }

  estimateRangeHeight(
    items: MessageDataItem[],
    startIndex: number,
    endIndex: number,
    width: number,
  ): number {
    const safeStart = Math.max(0, startIndex)
    const safeEnd = Math.min(items.length, endIndex)
    const cacheKey = `${getWidthBucket(width)}:${safeStart}:${safeEnd}`
    let itemCache = this.rangeHeightCache.get(items)

    if (!itemCache) {
      itemCache = new Map()
      this.rangeHeightCache.set(items, itemCache)
    }

    const cached = itemCache.get(cacheKey)

    if (typeof cached === 'number') {
      return cached
    }

    let height = 0

    for (let index = safeStart; index < safeEnd; index += 1) {
      const item = items[index]
      if (item) {
        height += this.estimateItemHeight(item, width)
      }
    }

    const clampedHeight = Math.max(0, height)
    itemCache.set(cacheKey, clampedHeight)
    return clampedHeight
  }

  computeTopSpacer(
    items: MessageDataItem[],
    startIndex: number,
    width: number,
  ): number {
    return this.estimateRangeHeight(items, 0, startIndex, width)
  }

  computeBottomSpacer(
    items: MessageDataItem[],
    endIndex: number,
    width: number,
  ): number {
    return this.estimateRangeHeight(items, endIndex + 1, items.length, width)
  }
}
