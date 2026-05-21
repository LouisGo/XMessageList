import { getRuntimeAnimationFrame } from './animationFrame'

export type RuntimeDomInputHandlers = {
  readonly onScrollFrame: (scrollTop: number) => void
  readonly onWheelBoundary: (event: WheelEvent) => boolean
}

export class RuntimeDomInputController {
  #container: HTMLElement | null = null
  #scrollRaf: number | null = null
  #latestScrollTop = 0
  #handlers: RuntimeDomInputHandlers | null = null

  attach(
    container: HTMLElement,
    handlers: RuntimeDomInputHandlers,
  ): void {
    this.detach()
    this.#container = container
    this.#handlers = handlers
    container.addEventListener('scroll', this.#handleScroll, { passive: true })
    container.addEventListener('wheel', this.#handleWheel, { passive: false })
  }

  detach(): void {
    if (this.#container !== null) {
      this.#container.removeEventListener('scroll', this.#handleScroll)
      this.#container.removeEventListener('wheel', this.#handleWheel)
    }
    if (this.#scrollRaf !== null) {
      getRuntimeAnimationFrame().cancel(this.#scrollRaf)
    }
    this.#container = null
    this.#handlers = null
    this.#scrollRaf = null
  }

  readonly #handleScroll = (): void => {
    const container = this.#container
    if (container === null || this.#handlers === null) return
    this.#latestScrollTop = Math.max(0, container.scrollTop)
    if (this.#scrollRaf !== null) return

    this.#scrollRaf = getRuntimeAnimationFrame().request(() => {
      this.#scrollRaf = null
      this.#handlers?.onScrollFrame(this.#latestScrollTop)
    })
  }

  readonly #handleWheel = (event: WheelEvent): void => {
    const preventDefault = this.#handlers?.onWheelBoundary(event) ?? false
    if (preventDefault && event.cancelable) {
      event.preventDefault()
    }
  }
}
