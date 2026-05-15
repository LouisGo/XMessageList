import type { MessageRuntimeItemKey } from '../types'
import { serializeRuntimeItemKey } from '../shared/utils'

export type RuntimeDomRegistrySnapshot = {
  observedRows: number
  hasContainer: boolean
}

/**
 * DomRegistry 只保存 runtime 能直接读取的 DOM 引用。
 * React ref callback 只能调用这里注册 / 注销，测量和滚动写入都留给 runtime transaction。
 */
export class DomRegistry {
  private container: HTMLElement | null = null

  private readonly rows = new Map<string, HTMLElement>()

  private readonly elementToKey = new WeakMap<HTMLElement, string>()

  private topSpacer: HTMLElement | null = null

  private bottomSpacer: HTMLElement | null = null

  private topSentinel: HTMLElement | null = null

  private bottomSentinel: HTMLElement | null = null

  attachContainer(container: HTMLElement): void {
    this.container = container
  }

  detachContainer(container?: HTMLElement): void {
    if (!container || this.container === container) {
      this.container = null
    }
  }

  getContainer(): HTMLElement | null {
    return this.container
  }

  registerRow(
    key: MessageRuntimeItemKey,
    element: HTMLElement | null,
  ): HTMLElement | null {
    const serializedKey = serializeRuntimeItemKey(key)
    const previous = this.rows.get(serializedKey) ?? null

    if (previous && previous !== element) {
      this.rows.delete(serializedKey)
    }

    if (!element) {
      this.rows.delete(serializedKey)
      return previous
    }

    this.rows.set(serializedKey, element)
    this.elementToKey.set(element, serializedKey)
    return previous
  }

  getRow(key: MessageRuntimeItemKey): HTMLElement | null {
    return this.rows.get(serializeRuntimeItemKey(key)) ?? null
  }

  getRowBySerializedKey(serializedKey: string): HTMLElement | null {
    return this.rows.get(serializedKey) ?? null
  }

  resolveKey(element: HTMLElement): string | null {
    return this.elementToKey.get(element) ?? null
  }

  registerTopSpacer(element: HTMLElement | null): void {
    this.topSpacer = element
  }

  registerBottomSpacer(element: HTMLElement | null): void {
    this.bottomSpacer = element
  }

  getTopSpacer(): HTMLElement | null {
    return this.topSpacer
  }

  getBottomSpacer(): HTMLElement | null {
    return this.bottomSpacer
  }

  registerTopSentinel(element: HTMLElement | null): void {
    this.topSentinel = element
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    this.bottomSentinel = element
  }

  getTopSentinel(): HTMLElement | null {
    return this.topSentinel
  }

  getBottomSentinel(): HTMLElement | null {
    return this.bottomSentinel
  }

  clearDomRefs(): void {
    this.container = null
    this.rows.clear()
    this.topSpacer = null
    this.bottomSpacer = null
    this.topSentinel = null
    this.bottomSentinel = null
  }

  getSnapshot(): RuntimeDomRegistrySnapshot {
    return {
      observedRows: this.rows.size,
      hasContainer: this.container !== null,
    }
  }
}
