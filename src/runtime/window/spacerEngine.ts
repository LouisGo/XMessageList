import type {
  HeightRecord,
  MessageDataItem,
  MessageRuntimeItemKey,
} from '../types'
import {
  DEFAULT_ITEM_ESTIMATE_PX,
  getItemEstimatedHeight,
  getRuntimeItemKey,
  getWidthBucket,
  serializeRuntimeItemKey,
} from '../shared/utils'

export type HeightCache = Map<string, HeightRecord>

const MAX_RANGE_HEIGHT_CACHE_ENTRIES = 128

/**
 * SpacerEngine 只做“局部估算 + 实测修正”，不建立全局精确 offset。
 * 这符合 IM runtime 的锚点模型：spacer 用来维持连续感，不是权威坐标。
 */
export class SpacerEngine {
  private rangeHeightCacheIdentity: string | null = null

  private readonly rangeHeightCache = new Map<string, number>()

  constructor(
    private readonly heightCache: HeightCache,
  ) {}

  invalidateEstimateCache(): void {
    this.rangeHeightCacheIdentity = null
    this.rangeHeightCache.clear()
  }

  setRangeCacheIdentity(identity: string): void {
    if (this.rangeHeightCacheIdentity === identity) {
      return
    }

    this.rangeHeightCacheIdentity = identity
    this.rangeHeightCache.clear()
  }

  estimateItemHeight(item: MessageDataItem, width: number): number {
    const key = serializeRuntimeItemKey(getRuntimeItemKey(item))
    const cached = this.heightCache.get(key)

    if (cached && cached.widthBucket === getWidthBucket(width)) {
      return cached.height
    }

    return getItemEstimatedHeight(item) ?? DEFAULT_ITEM_ESTIMATE_PX
  }

  estimateKeyHeight(key: MessageRuntimeItemKey): number {
    const cached = this.heightCache.get(serializeRuntimeItemKey(key))
    return cached?.height ?? DEFAULT_ITEM_ESTIMATE_PX
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
    const cached = this.rangeHeightCache.get(cacheKey)

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
    this.setRangeCache(cacheKey, clampedHeight)
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

  private setRangeCache(cacheKey: string, height: number): void {
    if (this.rangeHeightCache.size >= MAX_RANGE_HEIGHT_CACHE_ENTRIES) {
      const oldest = this.rangeHeightCache.keys().next().value

      if (typeof oldest === 'string') {
        this.rangeHeightCache.delete(oldest)
      }
    }

    this.rangeHeightCache.set(cacheKey, height)
  }
}
