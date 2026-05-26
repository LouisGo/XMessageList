import type { RuntimeObserverFactory, RuntimeScheduler } from '../runtime'

export class FakeScheduler implements RuntimeScheduler {
  private nextHandle = 1

  private time = 0

  private readonly frames = new Map<number, FrameRequestCallback>()

  private readonly timers = new Map<number, { at: number; callback: () => void }>()

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const handle = this.nextHandle
    this.nextHandle += 1
    this.frames.set(handle, callback)
    return handle
  }

  cancelAnimationFrame(handle: number): void {
    this.frames.delete(handle)
  }

  setTimeout(callback: () => void, timeoutMs: number): number {
    const handle = this.nextHandle
    this.nextHandle += 1
    this.timers.set(handle, {
      at: this.time + timeoutMs,
      callback,
    })
    return handle
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle)
  }

  now(): number {
    return this.time
  }

  flushFrame(): void {
    this.time += 16
    const callbacks = Array.from(this.frames.values())
    this.frames.clear()

    for (const callback of callbacks) {
      callback(this.time)
    }

    this.flushDueTimers()
  }

  flushFrames(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.flushFrame()
    }
  }

  flushTimers(): void {
    this.time += 10_000
    this.flushDueTimers()
  }

  private flushDueTimers(): void {
    const due = Array.from(this.timers.entries()).filter(
      ([, timer]) => timer.at <= this.time,
    )

    for (const [handle, timer] of due) {
      this.timers.delete(handle)
      timer.callback()
    }
  }
}

export class FakeResizeObserver implements ResizeObserver {
  readonly observed = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.observed.add(target)
  }

  unobserve(target: Element): void {
    this.observed.delete(target)
  }

  disconnect(): void {
    this.observed.clear()
  }

  trigger(target: Element, height: number): void {
    this.callback(
      [
        {
          target,
          contentRect: {
            height,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this,
    )
  }
}

export class FakeIntersectionObserver implements IntersectionObserver {
  readonly observed = new Set<Element>()

  readonly root: Element | Document | null = null

  readonly rootMargin = ''

  readonly thresholds: ReadonlyArray<number> = []

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.observed.add(target)
  }

  unobserve(target: Element): void {
    this.observed.delete(target)
  }

  disconnect(): void {
    this.observed.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  trigger(target: Element, isIntersecting: boolean): void {
    this.callback(
      [
        {
          target,
          isIntersecting,
        } as IntersectionObserverEntry,
      ],
      this,
    )
  }
}

export function createFakeObservers(): RuntimeObserverFactory & {
  resizeObservers: FakeResizeObserver[]
  intersectionObservers: FakeIntersectionObserver[]
} {
  const resizeObservers: FakeResizeObserver[] = []
  const intersectionObservers: FakeIntersectionObserver[] = []

  return {
    resizeObservers,
    intersectionObservers,
    createResizeObserver(callback) {
      const observer = new FakeResizeObserver(callback)
      resizeObservers.push(observer)
      return observer
    },
    createIntersectionObserver(callback) {
      const observer = new FakeIntersectionObserver(callback)
      intersectionObservers.push(observer)
      return observer
    },
  }
}

export function createContainer(input: {
  height: number
  width?: number
}): HTMLDivElement {
  const element = document.createElement('div')
  setElementMetrics(element, {
    top: 0,
    height: input.height,
    width: input.width ?? 320,
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: input.height,
  })
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: input.width ?? 320,
  })
  defineScrollHeight(element)
  return element
}

export function defineScrollHeight(element: HTMLElement): void {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get() {
      const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-height]'))
      return rows.reduce(
        (total, row) => total + Number(row.dataset.height ?? 0),
        0,
      )
    },
  })
}

export function setElementMetrics(
  element: HTMLElement,
  input: { top: number; height: number; width?: number },
): void {
  element.dataset.height = String(input.height)
  element.getBoundingClientRect = () =>
    ({
      top: input.top,
      bottom: input.top + input.height,
      left: 0,
      right: input.width ?? 320,
      width: input.width ?? 320,
      height: input.height,
      x: 0,
      y: input.top,
      toJSON: () => ({}),
    }) as DOMRect
}
