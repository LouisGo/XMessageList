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
import { HeightRangeIndex } from './heightRangeIndex'

export type HeightCache = Map<string, HeightRecord>

/**
 * SpacerEngine 只做“局部估算 + 实测修正”，不建立全局精确 offset。
 * 这符合 IM runtime 的锚点模型：spacer 用来维持连续感，不是权威坐标。
 */
export class SpacerEngine {
  private rangeHeightCacheIdentity: string | null = null

  private rangeIndexCache: {
    items: MessageDataItem[]
    identity: string
    widthBucket: number
    estimateRevision: number
    index: HeightRangeIndex
  } | null = null

  private estimateRevision = 0

  constructor(
    private readonly heightCache: HeightCache,
  ) {}

  invalidateEstimateCache(): void {
    this.rangeHeightCacheIdentity = null
    this.rangeIndexCache = null
    this.estimateRevision += 1
  }

  getEstimateRevision(): number {
    return this.estimateRevision
  }

  setRangeCacheIdentity(identity: string): void {
    if (this.rangeHeightCacheIdentity === identity) {
      return
    }

    this.rangeHeightCacheIdentity = identity
    this.rangeIndexCache = null
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
    return this.ensureRangeIndex(items, width).estimateRangeHeight(
      startIndex,
      endIndex,
    )
  }

  findEstimatedIndexAtOffset(
    items: MessageDataItem[],
    offsetPx: number,
    width: number,
  ): number {
    return this.ensureRangeIndex(items, width).findIndexAtOffset(offsetPx)
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

  private ensureRangeIndex(
    items: MessageDataItem[],
    width: number,
  ): HeightRangeIndex {
    const widthBucket = getWidthBucket(width)
    const identity =
      this.rangeHeightCacheIdentity ??
      `adhoc:${items.length}:${this.estimateRevision}`

    if (
      this.rangeIndexCache &&
      this.rangeIndexCache.items === items &&
      this.rangeIndexCache.identity === identity &&
      this.rangeIndexCache.widthBucket === widthBucket &&
      this.rangeIndexCache.estimateRevision === this.estimateRevision
    ) {
      return this.rangeIndexCache.index
    }

    const index = new HeightRangeIndex(
      items,
      width,
      (item, itemWidth) => this.estimateItemHeight(item, itemWidth),
    )

    this.rangeIndexCache = {
      items,
      identity,
      widthBucket,
      estimateRevision: this.estimateRevision,
      index,
    }
    return index
  }
}
