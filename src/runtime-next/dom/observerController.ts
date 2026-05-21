import { stringifyMessageRuntimeItemKey } from '../identity/itemKey'
import type { MessageRuntimeItemKey } from '../identity/types'

export type RuntimeDomObserverHandlers = {
  readonly onContainerResize: () => void
  readonly onRowResize: () => void
}

export class RuntimeDomObserverController {
  readonly #rows = new Map<string, HTMLElement>()
  #containerObserver: ResizeObserver | null = null
  #rowObserver: ResizeObserver | null = null

  constructor(private readonly handlers: RuntimeDomObserverHandlers) {}

  attach(container: HTMLElement): void {
    this.detachContainer()
    if (typeof ResizeObserver === 'undefined') return

    this.#containerObserver = new ResizeObserver(() => {
      this.handlers.onContainerResize()
    })
    this.#containerObserver.observe(container)

    this.#rowObserver = new ResizeObserver(() => {
      this.handlers.onRowResize()
    })
    for (const row of this.#rows.values()) {
      this.#rowObserver.observe(row)
    }
  }

  registerRow(
    key: MessageRuntimeItemKey,
    element: HTMLElement | null,
  ): void {
    const id = stringifyMessageRuntimeItemKey(key)
    const previous = this.#rows.get(id)
    if (previous !== undefined) {
      this.#rowObserver?.unobserve(previous)
      this.#rows.delete(id)
    }
    if (element === null) return

    this.#rows.set(id, element)
    this.#rowObserver?.observe(element)
  }

  detach(): void {
    this.detachContainer()
    this.#rows.clear()
  }

  private detachContainer(): void {
    this.#containerObserver?.disconnect()
    this.#rowObserver?.disconnect()
    this.#containerObserver = null
    this.#rowObserver = null
  }
}
