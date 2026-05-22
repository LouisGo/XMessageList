import {
  computeCustomScrollbarGeometry,
  type CustomScrollbarGeometry,
} from './customScrollbarGeometry'

export type CustomScrollbarElements = {
  container: HTMLElement
  track: HTMLElement
  thumb: HTMLElement
}

export class CustomScrollbarDom {
  private geometry: CustomScrollbarGeometry = computeCustomScrollbarGeometry({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  })
  private lastThumbHeight = ''
  private lastThumbTransform = ''

  constructor(private readonly elements: CustomScrollbarElements) {}

  get container(): HTMLElement {
    return this.elements.container
  }

  get track(): HTMLElement {
    return this.elements.track
  }

  get thumb(): HTMLElement {
    return this.elements.thumb
  }

  get ownerDocument(): Document {
    return this.container.ownerDocument
  }

  get ownerWindow(): Window {
    return this.ownerDocument.defaultView ?? window
  }

  getGeometry(): CustomScrollbarGeometry {
    return this.geometry
  }

  readGeometry(): CustomScrollbarGeometry {
    return computeCustomScrollbarGeometry({
      scrollTop: this.container.scrollTop,
      scrollHeight: this.container.scrollHeight,
      clientHeight: this.container.clientHeight,
    })
  }

  readTrackTop(): number {
    return this.track.getBoundingClientRect().top
  }

  applyGeometry(geometry: CustomScrollbarGeometry): void {
    this.geometry = geometry
    this.track.classList.toggle('is-scrollable', geometry.scrollable)

    if (!geometry.scrollable) {
      this.setVisible(false)
      this.writeThumbStyle('0px', `translate3d(0, ${geometry.trackStart}px, 0)`)
      return
    }

    this.writeThumbStyle(
      `${geometry.thumbLength}px`,
      `translate3d(0, ${geometry.thumbTop}px, 0)`,
    )
  }

  setVisible(visible: boolean): void {
    this.track.classList.toggle('is-visible', visible)
  }

  setHovering(hovering: boolean): void {
    this.track.classList.toggle('is-hovering', hovering)
  }

  setDragging(dragging: boolean): void {
    this.track.classList.toggle('is-dragging', dragging)
    this.ownerDocument.body.classList.toggle('x-message-scrollbar-dragging', dragging)
  }

  cleanup(): void {
    this.setVisible(false)
    this.setHovering(false)
    this.setDragging(false)
  }

  private writeThumbStyle(height: string, transform: string): void {
    if (this.lastThumbHeight !== height) {
      this.thumb.style.height = height
      this.lastThumbHeight = height
    }

    if (this.lastThumbTransform !== transform) {
      this.thumb.style.transform = transform
      this.lastThumbTransform = transform
    }
  }
}
