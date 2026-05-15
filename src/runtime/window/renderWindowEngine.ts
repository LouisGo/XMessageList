import type {
  MessageDataItem,
  MessageRuntimeItemKey,
  RenderWindow,
  WindowConfig,
} from '../types'
import { clamp, getRuntimeItemKey, serializeRuntimeItemKey } from '../shared/utils'
import type { SpacerEngine } from './spacerEngine'

type WindowAroundInput = {
  items: MessageDataItem[]
  anchorIndex: number
  viewportHeight: number
  viewportWidth: number
}

/**
 * RenderWindowEngine 只计算当前 DataSnapshot 内需要投影的 item 范围。
 * start/end index 是临时派生值，不能用于持久 restore 或跨层 anchor。
 */
export class RenderWindowEngine {
  constructor(
    private readonly config: WindowConfig,
    private readonly spacer: SpacerEngine,
  ) {}

  computeLatestWindow(
    items: MessageDataItem[],
    viewportHeight: number,
    viewportWidth: number,
  ): RenderWindow {
    if (items.length === 0) {
      return this.createEmptyWindow()
    }

    if (viewportHeight > 0 && viewportWidth > 0) {
      return this.computeWindowAroundAnchor({
        items,
        anchorIndex: items.length - 1,
        viewportHeight,
        viewportWidth,
      })
    }

    return this.computeLatestWindowByCount(items)
  }

  private computeLatestWindowByCount(items: MessageDataItem[]): RenderWindow {
    const mountedCount = Math.min(items.length, this.config.minMountedItems)
    const startIndex = Math.max(0, items.length - mountedCount)
    const endIndex = items.length - 1
    return this.createWindow(items, startIndex, endIndex)
  }

  computeWindowFromRange(
    items: MessageDataItem[],
    startIndex: number,
    endIndex: number,
  ): RenderWindow {
    if (items.length === 0) {
      return this.createEmptyWindow()
    }

    const start = clamp(startIndex, 0, items.length - 1)
    const end = clamp(Math.max(start, endIndex), start, items.length - 1)
    return this.createWindow(items, start, end)
  }

  computeWindowAroundAnchor(input: WindowAroundInput): RenderWindow {
    const { items, anchorIndex, viewportHeight, viewportWidth } = input

    if (items.length === 0) {
      return this.createEmptyWindow()
    }

    const safeAnchorIndex = clamp(anchorIndex, 0, items.length - 1)
    const minOverscanPx =
      this.config.minOverscanPx > 0
        ? this.config.minOverscanPx
        : viewportHeight * 2
    const maxOverscanPx =
      this.config.maxOverscanPx > 0
        ? this.config.maxOverscanPx
        : viewportHeight * 6

    // anchor 前后使用不同 overscan：上方保阅读连续性，下方多留空间减少向下滚动频繁 slide。
    const beforeTarget = clamp(viewportHeight * 3, minOverscanPx, maxOverscanPx)
    const afterTarget = clamp(viewportHeight * 4, minOverscanPx, maxOverscanPx)
    const startIndex = this.walkBackwardByEstimatedHeight(
      items,
      safeAnchorIndex,
      beforeTarget,
      viewportWidth,
    )
    const endIndex = this.walkForwardByEstimatedHeight(
      items,
      safeAnchorIndex,
      afterTarget,
      viewportWidth,
    )

    return this.clampMountedCount(items, startIndex, endIndex, safeAnchorIndex)
  }

  findIndexByKey(
    items: MessageDataItem[],
    key: MessageRuntimeItemKey,
  ): number {
    const serializedKey = serializeRuntimeItemKey(key)
    return items.findIndex(
      (item) => serializeRuntimeItemKey(getRuntimeItemKey(item)) === serializedKey,
    )
  }

  private walkBackwardByEstimatedHeight(
    items: MessageDataItem[],
    anchorIndex: number,
    targetPx: number,
    width: number,
  ): number {
    let height = 0
    let index = anchorIndex

    while (index > 0 && height < targetPx) {
      index -= 1
      const item = items[index]
      if (item) {
        height += this.spacer.estimateItemHeight(item, width)
      }
    }

    return index
  }

  private walkForwardByEstimatedHeight(
    items: MessageDataItem[],
    anchorIndex: number,
    targetPx: number,
    width: number,
  ): number {
    let height = 0
    let index = anchorIndex

    while (index < items.length - 1 && height < targetPx) {
      index += 1
      const item = items[index]
      if (item) {
        height += this.spacer.estimateItemHeight(item, width)
      }
    }

    return index
  }

  private clampMountedCount(
    items: MessageDataItem[],
    startIndex: number,
    endIndex: number,
    anchorIndex: number,
  ): RenderWindow {
    let start = startIndex
    let end = endIndex
    const count = end - start + 1

    if (count < this.config.minMountedItems) {
      let remaining = Math.min(items.length, this.config.minMountedItems) - count
      const preferredBefore = Math.min(start, Math.floor(remaining / 2))
      start -= preferredBefore
      remaining -= preferredBefore

      const afterRoom = items.length - 1 - end
      const expandAfter = Math.min(afterRoom, remaining)
      end += expandAfter
      remaining -= expandAfter

      if (remaining > 0) {
        start = Math.max(0, start - remaining)
      }

      start = Math.max(0, Math.min(start, anchorIndex))
    }

    if (end - start + 1 > this.config.maxMountedItems) {
      // maxMountedItems 是硬上限；超过时以 anchor 为中心裁剪，避免为了 spacer 精度无限挂 DOM。
      const beforeCount = Math.floor(this.config.maxMountedItems / 2)
      start = Math.max(0, anchorIndex - beforeCount)
      end = Math.min(items.length - 1, start + this.config.maxMountedItems - 1)
      start = Math.max(0, end - this.config.maxMountedItems + 1)
    }

    return this.createWindow(items, start, end)
  }

  private createWindow(
    items: MessageDataItem[],
    startIndex: number,
    endIndex: number,
  ): RenderWindow {
    return {
      startIndex,
      endIndex,
      itemKeys: items
        .slice(startIndex, endIndex + 1)
        .map((item) => getRuntimeItemKey(item)),
    }
  }

  private createEmptyWindow(): RenderWindow {
    return {
      startIndex: 0,
      endIndex: -1,
      itemKeys: [],
    }
  }
}
