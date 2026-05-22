import type {
  MessageDataItem,
  MessageRuntimeItemKey,
  RuntimeObserverFactory,
} from '../types'
import {
  getItemContentVersion,
  getRuntimeItemKey,
  getWidthBucket,
  serializeRuntimeItemKey,
} from '../shared/utils'
import type { HeightCache } from '../window/spacerEngine'
import { readResizeObserverBoxHeight } from './resizeObserverBox'

export type HeightDelta = {
  key: MessageRuntimeItemKey
  serializedKey: string
  previousHeight: number
  nextHeight: number
  delta: number
}

type PendingHeight = {
  key: MessageRuntimeItemKey
  previousHeight: number
  nextHeight: number
}

/**
 * MeasurementEngine 只观察和缓存局部 mounted row 的高度。
 * ResizeObserver 回调只记录 dirty height，真正的 scrollTop 修正必须回到 rAF transaction。
 */
export class MeasurementEngine {
  private readonly rowObserver: ResizeObserver | null

  private readonly elementToKey = new WeakMap<HTMLElement, MessageRuntimeItemKey>()

  private readonly elementToSerializedKey = new WeakMap<HTMLElement, string>()

  private readonly keyToElement = new Map<string, HTMLElement>()

  private readonly pendingHeights = new Map<string, PendingHeight>()

  private widthBucket = 0

  constructor(
    private readonly heightCache: HeightCache,
    observerFactory: RuntimeObserverFactory,
    private readonly onDirtyHeight: () => void,
  ) {
    this.rowObserver = observerFactory.createResizeObserver((entries) => {
      this.handleResizeEntries(entries)
    })
  }

  observeRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    if (!element) {
      return
    }

    const serializedKey = serializeRuntimeItemKey(key)
    const previousSerializedKey = this.elementToSerializedKey.get(element)

    if (previousSerializedKey && previousSerializedKey !== serializedKey) {
      this.keyToElement.delete(previousSerializedKey)
    }

    this.elementToKey.set(element, key)
    this.elementToSerializedKey.set(element, serializedKey)
    this.keyToElement.set(serializedKey, element)
    if (!this.rowObserver) {
      return
    }

    this.rowObserver.observe(element)
  }

  unobserveRow(element: HTMLElement | null): void {
    if (!element) {
      return
    }

    this.rowObserver?.unobserve(element)

    const serializedKey = this.elementToSerializedKey.get(element)

    if (serializedKey) {
      this.keyToElement.delete(serializedKey)
    }
  }

  disconnect(): void {
    this.rowObserver?.disconnect()
    this.pendingHeights.clear()
    this.keyToElement.clear()
  }

  measureMountedRows(
    items: MessageDataItem[],
    revision: number,
    containerWidth: number,
  ): HeightDelta[] {
    const deltas: HeightDelta[] = []
    this.widthBucket = getWidthBucket(containerWidth)

    for (const item of items) {
      const key = getRuntimeItemKey(item)
      const element = this.findObservedElement(key)

      if (!element) {
        continue
      }

      const delta = this.updateHeightRecord(
        key,
        this.readElementHeight(element),
        getItemContentVersion(item),
        revision,
      )

      if (delta) {
        deltas.push(delta)
      }
    }

    this.trimCache(items)
    return deltas
  }

  flushPendingHeightDeltas(
    revision: number,
    containerWidth: number,
  ): HeightDelta[] {
    const deltas: HeightDelta[] = []
    this.widthBucket = getWidthBucket(containerWidth)

    for (const [serializedKey, pending] of this.pendingHeights) {
      const previous = this.heightCache.get(serializedKey)
      const previousHeight = previous?.height ?? pending.previousHeight
      const delta = pending.nextHeight - previousHeight

      // ResizeObserver 只知道元素尺寸，不知道消息版本；contentVersion 由主动测量路径刷新。
      this.heightCache.set(serializedKey, {
        height: pending.nextHeight,
        measuredAtRevision: revision,
        contentVersion: previous?.contentVersion ?? 0,
        widthBucket: this.widthBucket,
        lastAccessedAt: Date.now(),
      })

      if (Math.abs(delta) > 0.5) {
        deltas.push({
          key: pending.key,
          serializedKey,
          previousHeight,
          nextHeight: pending.nextHeight,
          delta,
        })
      }
    }

    this.pendingHeights.clear()
    return deltas
  }

  invalidateForWidth(width: number): boolean {
    const nextBucket = getWidthBucket(width)

    if (nextBucket === this.widthBucket) {
      return false
    }

    // 宽度 bucket 变化意味着文本换行模型变化，旧高度缓存不能再用于 spacer 估算。
    this.widthBucket = nextBucket
    this.heightCache.clear()
    this.pendingHeights.clear()
    return true
  }

  private handleResizeEntries(entries: ResizeObserverEntry[]): void {
    let dirty = false

    for (const entry of entries) {
      const target = entry.target

      if (!(target instanceof HTMLElement)) {
        continue
      }

      const key = this.elementToKey.get(target)

      if (!key) {
        continue
      }

      const serializedKey = serializeRuntimeItemKey(key)
      const previousHeight =
        this.pendingHeights.get(serializedKey)?.previousHeight ??
        this.heightCache.get(serializedKey)?.height ??
        this.readElementHeight(target)
      const nextHeight = this.readResizeEntryHeight(entry, target)

      if (Math.abs(nextHeight - previousHeight) <= 0.5) {
        continue
      }

      this.pendingHeights.set(serializedKey, {
        key,
        previousHeight,
        nextHeight,
      })
      dirty = true
    }

    if (dirty) {
      this.onDirtyHeight()
    }
  }

  private updateHeightRecord(
    key: MessageRuntimeItemKey,
    nextHeight: number,
    contentVersion: number,
    revision: number,
  ): HeightDelta | null {
    const serializedKey = serializeRuntimeItemKey(key)
    const previous = this.heightCache.get(serializedKey)
    const previousHeight = previous?.height ?? nextHeight

    this.heightCache.set(serializedKey, {
      height: nextHeight,
      measuredAtRevision: revision,
      contentVersion,
      widthBucket: this.widthBucket,
      lastAccessedAt: Date.now(),
    })

    const delta = nextHeight - previousHeight

    if (Math.abs(delta) <= 0.5) {
      return null
    }

    return {
      key,
      serializedKey,
      previousHeight,
      nextHeight,
      delta,
    }
  }

  private readResizeEntryHeight(
    entry: ResizeObserverEntry,
    target: HTMLElement,
  ): number {
    const boxHeight = readResizeObserverBoxHeight(entry)

    if (boxHeight > 0) {
      return boxHeight
    }

    if (entry.contentRect.height > 0) {
      return entry.contentRect.height
    }

    return this.readElementHeight(target)
  }

  private readElementHeight(element: HTMLElement): number {
    const rect = element.getBoundingClientRect()
    return Math.max(0, rect.height)
  }

  private findObservedElement(key: MessageRuntimeItemKey): HTMLElement | null {
    return this.keyToElement.get(serializeRuntimeItemKey(key)) ?? null
  }

  private trimCache(items: MessageDataItem[]): void {
    if (this.heightCache.size <= 1000) {
      return
    }

    const liveKeys = new Set(
      items.map((item) => serializeRuntimeItemKey(getRuntimeItemKey(item))),
    )

    for (const key of this.heightCache.keys()) {
      if (this.heightCache.size <= 1000) {
        break
      }

      if (!liveKeys.has(key)) {
        this.heightCache.delete(key)
      }
    }
  }
}
