import type { DirectScrollSource, MessageViewportRuntime } from '../../runtime'
import {
  getScrollbarPointerOverflowDirection,
  getScrollbarTrackPageScrollTop,
  getScrollTopForScrollbarPointer,
  type CustomScrollbarGeometry,
} from './customScrollbarGeometry'
import { CustomScrollbarDom } from './customScrollbarDom'
import { CustomScrollbarObservers } from './customScrollbarObservers'

type CustomScrollbarControllerOptions<TMessage, TOptimistic> = {
  container: HTMLElement
  track: HTMLElement
  thumb: HTMLElement
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
}

type DragState = {
  pointerId: number
  pointerY: number
  grabOffset: number
  captureElement: HTMLElement
  trackTop: number
}

type SyncRequest = {
  reveal?: boolean
  keepVisible?: boolean
}

const hideDelayMs = 650
const scrollWriteEpsilonPx = 0.5

export class CustomScrollbarController<TMessage, TOptimistic> {
  private readonly dom: CustomScrollbarDom
  private readonly observers: CustomScrollbarObservers
  private syncFrame: number | null = null
  private dragFrame: number | null = null
  private hideTimer: number | null = null
  private pendingSync: SyncRequest | null = null
  private drag: DragState | null = null
  private hovering = false

  constructor(
    private readonly options: CustomScrollbarControllerOptions<
      TMessage,
      TOptimistic
    >,
  ) {
    this.dom = new CustomScrollbarDom(options)
    this.observers = new CustomScrollbarObservers(this.dom, {
      onScroll: this.handleScroll,
      onContainerPointerEnter: this.handleContainerPointerEnter,
      onContainerPointerLeave: this.handleContainerPointerLeave,
      onScrollbarPointerEnter: this.handleScrollbarPointerEnter,
      onScrollbarPointerLeave: this.handleScrollbarPointerLeave,
      onTrackPointerDown: this.handleTrackPointerDown,
      onThumbPointerDown: this.handleThumbPointerDown,
      onDocumentPointerMove: this.handleDocumentPointerMove,
      onDocumentPointerEnd: this.handleDocumentPointerEnd,
      onGeometryDirty: this.handleGeometryDirty,
    })
  }

  attach(): void {
    this.observers.attach()
    this.syncNow()
  }

  destroy(): void {
    if (this.drag) {
      this.finishDrag()
    }

    this.observers.destroy()
    this.cancelSyncFrame()
    this.cancelDragFrame()
    this.clearHideTimer()
    this.dom.cleanup()
  }

  syncFromProjection(): void {
    this.syncNow({
      reveal: Boolean(this.drag),
      keepVisible: Boolean(this.drag),
    })
  }

  private readonly handleScroll = (): void => {
    this.queueSync({ reveal: true, keepVisible: Boolean(this.drag) })
  }

  private readonly handleContainerPointerEnter = (): void => {
    this.dom.setVisible(true)
    this.clearHideTimer()
    this.queueSync({ keepVisible: true })
  }

  private readonly handleContainerPointerLeave = (): void => {
    if (!this.drag) {
      this.scheduleHide()
    }
  }

  private readonly handleScrollbarPointerEnter = (): void => {
    this.hovering = true
    this.dom.setHovering(true)
    this.dom.setVisible(true)
    this.clearHideTimer()
    this.queueSync({ keepVisible: true })
  }

  private readonly handleScrollbarPointerLeave = (): void => {
    this.hovering = false
    this.dom.setHovering(false)
    if (!this.drag) {
      this.scheduleHide()
    }
  }

  private readonly handleThumbPointerDown = (event: PointerEvent): void => {
    event.stopPropagation()
    const geometry = this.dom.readGeometry()
    const trackTop = this.dom.readTrackTop()
    const pointerTrackY = event.clientY - trackTop
    const grabOffset = Math.min(
      geometry.thumbLength,
      Math.max(0, pointerTrackY - geometry.thumbTop),
    )

    this.startDrag(event, this.dom.thumb, grabOffset, trackTop, geometry)
  }

  private readonly handleTrackPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return
    }

    const geometry = this.dom.readGeometry()
    if (!geometry.scrollable) {
      return
    }

    const trackTop = this.dom.readTrackTop()
    const clickY = event.clientY - trackTop
    const thumbStart = geometry.thumbTop
    const thumbEnd = thumbStart + geometry.thumbLength

    if (clickY >= thumbStart && clickY <= thumbEnd) {
      this.startDrag(event, this.dom.track, clickY - thumbStart, trackTop, geometry)
      return
    }

    event.preventDefault()
    const nextScrollTop = getScrollbarTrackPageScrollTop({
      clickY,
      scrollTop: this.dom.container.scrollTop,
      clientHeight: this.dom.container.clientHeight,
      geometry,
    })

    this.beginDirectScroll('custom-scrollbar-track')
    const committed = this.commitDirectScrollTop(
      nextScrollTop,
      'custom-scrollbar-track',
    )
    this.endDirectScroll('custom-scrollbar-track')
    if (committed) {
      this.syncNow({ reveal: true })
    } else {
      this.dom.setVisible(true)
      this.clearHideTimer()
    }
  }

  private readonly handleDocumentPointerMove = (event: PointerEvent): void => {
    const drag = this.drag
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }

    event.preventDefault()
    drag.pointerY = event.clientY
    this.scheduleDragFrame()
  }

  private readonly handleDocumentPointerEnd = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) {
      return
    }

    this.flushDragFrame()
    this.finishDrag()
    this.scheduleHide()
  }

  private readonly handleGeometryDirty = (): void => {
    this.queueSync({ reveal: true, keepVisible: Boolean(this.drag) })
  }

  private startDrag(
    event: PointerEvent,
    captureElement: HTMLElement,
    grabOffset: number,
    trackTop: number,
    geometry: CustomScrollbarGeometry,
  ): void {
    if (event.button !== 0 || !geometry.scrollable) {
      return
    }

    event.preventDefault()
    captureElement.setPointerCapture?.(event.pointerId)
    this.drag = {
      pointerId: event.pointerId,
      pointerY: event.clientY,
      grabOffset,
      captureElement,
      trackTop,
    }
    this.dom.setDragging(true)
    this.dom.setVisible(true)
    this.clearHideTimer()
    this.beginDirectScroll('custom-scrollbar-drag')
    this.scheduleDragFrame()
  }

  private finishDrag(): void {
    const drag = this.drag
    if (!drag) {
      return
    }

    drag.captureElement.releasePointerCapture?.(drag.pointerId)
    this.drag = null
    this.cancelDragFrame()
    this.dom.setDragging(false)
    this.endDirectScroll('custom-scrollbar-drag')
  }

  private applyDragFrame(): void {
    this.dragFrame = null
    const drag = this.drag
    if (!drag) {
      return
    }

    const beforeScrollTop = this.dom.container.scrollTop
    this.writeScrollTopFromPointer(drag)
    const changed =
      Math.abs(this.dom.container.scrollTop - beforeScrollTop) >= scrollWriteEpsilonPx
    const direction = getScrollbarPointerOverflowDirection(
      drag.pointerY,
      drag.trackTop,
      this.dom.getGeometry(),
    )

    if (direction && changed) {
      this.scheduleDragFrame()
    }
  }

  private writeScrollTopFromPointer(drag: DragState): void {
    const geometry = this.dom.readGeometry()
    const nextScrollTop = getScrollTopForScrollbarPointer({
      pointerY: drag.pointerY,
      trackTop: drag.trackTop,
      grabOffset: drag.grabOffset,
      geometry,
      fallbackScrollTop: this.dom.container.scrollTop,
    })

    if (Math.abs(nextScrollTop - this.dom.container.scrollTop) < scrollWriteEpsilonPx) {
      this.syncNow({ reveal: true, keepVisible: true })
      return
    }

    if (!this.commitDirectScrollTop(nextScrollTop, 'custom-scrollbar-drag')) {
      this.dom.setVisible(true)
      this.clearHideTimer()
      return
    }

    this.syncNow({ reveal: true, keepVisible: true })
  }

  private syncNow(input?: SyncRequest): void {
    const geometry = this.dom.readGeometry()
    this.dom.applyGeometry(geometry)
    this.rebaseActiveDrag(geometry)

    if (!geometry.scrollable) {
      return
    }

    if (input?.reveal) {
      this.dom.setVisible(true)
    }

    if (input?.keepVisible || this.drag || this.hovering) {
      this.clearHideTimer()
      return
    }

    if (input?.reveal) {
      this.scheduleHide()
    }
  }

  private rebaseActiveDrag(geometry: CustomScrollbarGeometry): void {
    const drag = this.drag
    if (!drag || !geometry.scrollable) {
      return
    }

    const trackTop = this.dom.readTrackTop()
    const pointerTrackY = drag.pointerY - trackTop
    // projection/分页改变 scrollHeight 后，保持指针相对 thumb 的抓取点不变，避免 thumb 在手下跳动。
    drag.trackTop = trackTop
    drag.grabOffset = pointerTrackY - geometry.thumbTop
  }

  private queueSync(input?: SyncRequest): void {
    this.pendingSync = {
      reveal: Boolean(this.pendingSync?.reveal || input?.reveal),
      keepVisible: Boolean(this.pendingSync?.keepVisible || input?.keepVisible),
    }

    if (this.syncFrame !== null) {
      return
    }

    // 测试宿主可能同步执行 rAF；-1 表示已排队但还没拿到真实 frame id。
    this.syncFrame = -1
    const frame = this.dom.ownerWindow.requestAnimationFrame(() => {
      this.syncFrame = null
      const request = this.pendingSync
      this.pendingSync = null
      this.syncNow(request ?? undefined)
    })
    if (this.syncFrame === -1) {
      this.syncFrame = frame
    }
  }

  private scheduleDragFrame(): void {
    if (this.dragFrame !== null) {
      return
    }

    // 测试宿主可能同步执行 rAF；-1 表示已排队但还没拿到真实 frame id。
    this.dragFrame = -1
    const frame = this.dom.ownerWindow.requestAnimationFrame(() => {
      this.applyDragFrame()
    })
    if (this.dragFrame === -1) {
      this.dragFrame = frame
    }
  }

  private flushDragFrame(): void {
    if (this.dragFrame === null) {
      return
    }

    this.cancelDragFrame()
    this.applyDragFrame()
  }

  private cancelSyncFrame(): void {
    if (this.syncFrame !== null && this.syncFrame >= 0) {
      this.dom.ownerWindow.cancelAnimationFrame(this.syncFrame)
    }
    this.syncFrame = null
  }

  private cancelDragFrame(): void {
    if (this.dragFrame !== null && this.dragFrame >= 0) {
      this.dom.ownerWindow.cancelAnimationFrame(this.dragFrame)
    }
    this.dragFrame = null
  }

  private scheduleHide(): void {
    this.clearHideTimer()
    this.hideTimer = this.dom.ownerWindow.setTimeout(() => {
      this.hideTimer = null
      if (!this.hovering && !this.drag) {
        this.dom.setVisible(false)
      }
    }, hideDelayMs)
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      this.dom.ownerWindow.clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  private beginDirectScroll(source: DirectScrollSource): void {
    this.options.runtime.beginDirectScroll({ source })
  }

  private commitDirectScrollTop(
    scrollTop: number,
    source: DirectScrollSource,
  ): boolean {
    // runtime 是 scrollTop 写入的唯一 owner；overlay 只提交几何换算后的目标值。
    return this.options.runtime.writeDirectScrollTop(scrollTop, { source })
  }

  private endDirectScroll(source: DirectScrollSource): void {
    this.options.runtime.endDirectScroll({ source })
  }
}
