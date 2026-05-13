import type {
  MessageDataItem,
  MessageRuntimeItemKey,
  RuntimeObserverFactory,
} from './types'
import {
  getItemContentVersion,
  getRuntimeItemKey,
  getWidthBucket,
  serializeRuntimeItemKey,
} from './utils'
import type { HeightCache } from './spacerEngine'

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

    this.elementToKey.set(element, key)
    this.keyToElement.set(serializeRuntimeItemKey(key), element)
    if (!this.rowObserver) {
      return
    }

    this.rowObserver.observe(element)
  }

  unobserveRow(element: HTMLElement | null): void {
    if (!this.rowObserver || !element) {
      return
    }

    this.rowObserver.unobserve(element)
    for (const [serializedKey, currentElement] of this.keyToElement) {
      if (currentElement === element) {
        this.keyToElement.delete(serializedKey)
        break
      }
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
    const liveKeys = new Set(
      items.map((item) => serializeRuntimeItemKey(getRuntimeItemKey(item))),
    )

    for (const key of this.heightCache.keys()) {
      if (!liveKeys.has(key) && this.heightCache.size > 1000) {
        this.heightCache.delete(key)
      }
    }
  }
}
