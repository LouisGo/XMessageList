import type { MessageRuntimeItemKey } from '../identity/types'
import { stringifyMessageRuntimeItemKey } from '../identity/itemKey'

export type RuntimeViewportSize = {
  readonly clientHeight: number
  readonly clientWidth: number
}

export type RuntimeDomMeasurement = {
  readonly mountedRowsHeight: number
  readonly measuredRowHeights: ReadonlyMap<string, number>
}

export class RuntimeDomRegistry {
  #container: HTMLElement | null = null
  readonly #rows = new Map<string, HTMLElement>()

  attach(container: HTMLElement): void {
    this.#container = container
  }

  detach(): void {
    this.#container = null
    this.#rows.clear()
  }

  getContainer(): HTMLElement | null {
    return this.#container
  }

  getViewportSize(): RuntimeViewportSize {
    return {
      clientHeight: toNonNegativeFinitePx(this.#container?.clientHeight ?? 0),
      clientWidth: toNonNegativeFinitePx(this.#container?.clientWidth ?? 0),
    }
  }

  getScrollTop(): number {
    return toNonNegativeFinitePx(this.#container?.scrollTop ?? 0)
  }

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    const id = stringifyMessageRuntimeItemKey(key)
    if (element === null) {
      this.#rows.delete(id)
      return
    }

    this.#rows.set(id, element)
  }

  registerTopSpacer(element: HTMLElement | null): void {
    void element
  }

  registerBottomSpacer(element: HTMLElement | null): void {
    void element
  }

  registerTopSentinel(element: HTMLElement | null): void {
    void element
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    void element
  }

  measureRows(keys: readonly MessageRuntimeItemKey[]): RuntimeDomMeasurement {
    const measuredRowHeights = new Map<string, number>()
    let mountedRowsHeight = 0

    for (const key of keys) {
      const id = stringifyMessageRuntimeItemKey(key)
      const element = this.#rows.get(id)
      const height = measureElementHeight(element)
      if (height !== null) {
        measuredRowHeights.set(id, height)
        mountedRowsHeight += height
      }
    }

    return {
      mountedRowsHeight,
      measuredRowHeights,
    }
  }
}

function measureElementHeight(element: HTMLElement | undefined): number | null {
  if (element === undefined) {
    return null
  }

  return toNonNegativeFinitePx(element.getBoundingClientRect().height)
}

function toNonNegativeFinitePx(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}
