import type { MessageRuntimeItemKey } from './identity'

export type RuntimeDomRegistrySnapshot = {
  scrollContainer: HTMLElement | null
  messageFlow: HTMLElement | null
  beforeTrigger: HTMLElement | null
  afterTrigger: HTMLElement | null
  bottomMarker: HTMLElement | null
  rows: Map<MessageRuntimeItemKey, HTMLElement>
}

export class RuntimeDomRegistry {
  private scrollContainer: HTMLElement | null = null
  private messageFlow: HTMLElement | null = null
  private beforeTrigger: HTMLElement | null = null
  private afterTrigger: HTMLElement | null = null
  private bottomMarker: HTMLElement | null = null
  private readonly rows = new Map<MessageRuntimeItemKey, HTMLElement>()

  setScrollContainer(element: HTMLElement | null): void {
    this.scrollContainer = element
  }

  setMessageFlow(element: HTMLElement | null): void {
    this.messageFlow = element
  }

  setBeforeTrigger(element: HTMLElement | null): void {
    this.beforeTrigger = element
  }

  setAfterTrigger(element: HTMLElement | null): void {
    this.afterTrigger = element
  }

  setBottomMarker(element: HTMLElement | null): void {
    this.bottomMarker = element
  }

  setRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    if (!element) {
      this.rows.delete(key)
      return
    }

    this.rows.set(key, element)
  }

  getRow(key: MessageRuntimeItemKey): HTMLElement | null {
    return this.rows.get(key) ?? null
  }

  snapshot(): RuntimeDomRegistrySnapshot {
    return {
      scrollContainer: this.scrollContainer,
      messageFlow: this.messageFlow,
      beforeTrigger: this.beforeTrigger,
      afterTrigger: this.afterTrigger,
      bottomMarker: this.bottomMarker,
      rows: new Map(this.rows),
    }
  }

  clearAll(): HTMLElement[] {
    const rows = Array.from(this.rows.values())

    this.scrollContainer = null
    this.messageFlow = null
    this.beforeTrigger = null
    this.afterTrigger = null
    this.bottomMarker = null
    this.rows.clear()

    return rows
  }
}
