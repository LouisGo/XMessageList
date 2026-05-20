/* eslint-disable react-hooks/exhaustive-deps */
import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useEffect,
  useRef,
} from 'react'
import type { DirectScrollSource, MessageViewportRuntime } from '../../runtime.deprecated'
import {
  computeCustomScrollbarGeometry,
  type CustomScrollbarGeometry,
} from './customScrollbarGeometry'

type CustomScrollbarProps = {
  container: HTMLElement | null
  runtime: MessageViewportRuntime<unknown, unknown>
  enabled?: boolean
  geometryVersion?: number
}

type DragState = {
  pointerId: number
  pointerY: number
  grabOffset: number
  captureElement: HTMLElement
}

type SyncRequest = {
  reveal?: boolean
  keepVisible?: boolean
}

const hideDelayMs = 650
const scrollWriteEpsilonPx = 0.5
const customScrollbarStyle = `
[data-custom-scrollbar="true"] [data-message-scroll-container]::-webkit-scrollbar {
  display: none;
}

[data-custom-scrollbar="true"] [data-message-scroll-container] {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

[data-custom-scrollbar="true"] .x-message-scrollbar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 18px;
  z-index: 3;
  pointer-events: auto;
  opacity: 0;
  transition: opacity 140ms linear;
}

[data-custom-scrollbar="true"] .x-message-scrollbar.is-scrollable.is-visible,
[data-custom-scrollbar="true"] .x-message-scrollbar.is-scrollable.is-hovering,
[data-custom-scrollbar="true"] .x-message-scrollbar.is-scrollable.is-dragging {
  opacity: 1;
}

[data-custom-scrollbar="true"] .x-message-scrollbar-thumb {
  position: absolute;
  right: 2px;
  width: 6px;
  border-radius: 999px;
  background: rgb(109 122 130 / 0.52);
  transition:
    width 120ms linear,
    right 120ms linear,
    background-color 120ms linear,
    transform 0ms linear;
  pointer-events: auto;
}

[data-custom-scrollbar="true"] .x-message-scrollbar.is-hovering .x-message-scrollbar-thumb,
[data-custom-scrollbar="true"] .x-message-scrollbar.is-dragging .x-message-scrollbar-thumb,
body.x-message-scrollbar-dragging .x-message-scrollbar-thumb {
  right: 2px;
  width: 8px;
  background: rgb(109 122 130 / 0.72);
}

body.x-message-scrollbar-dragging {
  user-select: none;
}
`

export function CustomScrollbar({
  container,
  runtime,
  enabled = true,
  geometryVersion,
}: CustomScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLElement | null>(container)
  const geometryRef = useRef<CustomScrollbarGeometry>(
    computeCustomScrollbarGeometry({
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
    }),
  )
  const frameRef = useRef<number | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const pendingSyncRef = useRef<SyncRequest | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const hoverRef = useRef(false)

  const directScrollInput = (source: DirectScrollSource) => ({ source })

  const beginDirectScroll = (source: DirectScrollSource) => {
    runtime.beginDirectScroll(directScrollInput(source))
  }

  const writeDirectScrollTop = (
    scrollTop: number,
    source: DirectScrollSource,
  ) => {
    return runtime.writeDirectScrollTop(scrollTop, directScrollInput(source))
  }

  const commitDirectScrollTop = (
    nextScrollTop: number,
    source: DirectScrollSource,
  ): boolean => {
    if (!container) {
      return false
    }

    // runtime 是 scrollTop 写入的唯一 owner；React 只提交几何换算后的目标值。
    // 返回 false 说明 runtime 当前没有可写容器，React 不能自行兜底写 DOM。
    return writeDirectScrollTop(nextScrollTop, source)
  }

  const endDirectScroll = (source: DirectScrollSource) => {
    runtime.endDirectScroll(directScrollInput(source))
  }

  const setVisible = (visible: boolean) => {
    const track = trackRef.current
    if (!track) {
      return
    }

    track.classList.toggle('is-visible', visible)
  }

  const scheduleHide = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
    }

    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      if (!hoverRef.current && !dragStateRef.current) {
        setVisible(false)
      }
    }, hideDelayMs)
  }

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const readGeometry = (): CustomScrollbarGeometry => {
    if (!container) {
      return geometryRef.current
    }

    return computeCustomScrollbarGeometry({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    })
  }

  const clearDragFrame = () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
  }

  const applyGeometry = (geometry: CustomScrollbarGeometry) => {
    geometryRef.current = geometry

    const track = trackRef.current
    const thumb = thumbRef.current
    if (!track || !thumb) {
      return
    }

    track.classList.toggle('is-scrollable', geometry.scrollable)
    if (!geometry.scrollable) {
      setVisible(false)
      thumb.style.height = '0px'
      thumb.style.transform = `translate3d(0, ${geometry.trackStart}px, 0)`
      return
    }

    thumb.style.height = `${geometry.thumbLength}px`
    thumb.style.transform = `translate3d(0, ${geometry.thumbTop}px, 0)`
  }

  const rebaseActiveDrag = (geometry: CustomScrollbarGeometry) => {
    const drag = dragStateRef.current
    const trackRect = trackRef.current?.getBoundingClientRect()
    if (!drag || !trackRect || !geometry.scrollable) {
      return
    }

    const pointerTrackY = drag.pointerY - trackRect.top

    // 内容高度变化后 thumb 位置会重新计算；保持指针相对 thumb 的抓取点不变，
    // 否则分页追加/预加载会让正在拖拽的 thumb 在手指下跳动。
    dragStateRef.current = {
      ...drag,
      grabOffset: pointerTrackY - geometry.thumbTop,
    }
  }

  const getScrollTopForPointer = (
    pointerY: number,
    drag: DragState,
    geometry: CustomScrollbarGeometry,
  ): number => {
    const trackRect = trackRef.current?.getBoundingClientRect()
    if (!trackRect || !geometry.scrollable) {
      return container?.scrollTop ?? 0
    }

    const availableTravel = Math.max(0, geometry.trackLength - geometry.thumbLength)
    if (availableTravel <= 0 || geometry.maxScrollTop <= 0) {
      return 0
    }

    const rawThumbTop = pointerY - trackRect.top - drag.grabOffset
    const thumbTop = Math.min(
      geometry.trackStart + availableTravel,
      Math.max(geometry.trackStart, rawThumbTop),
    )
    const progress = (thumbTop - geometry.trackStart) / availableTravel

    return progress * geometry.maxScrollTop
  }

  const writeScrollTopFromPointer = (pointerY: number, drag: DragState) => {
    if (!container) {
      return
    }

    const geometry = readGeometry()
    const nextScrollTop = getScrollTopForPointer(pointerY, drag, geometry)

    if (Math.abs(nextScrollTop - container.scrollTop) < scrollWriteEpsilonPx) {
      syncNow({ reveal: true, keepVisible: true })
      return
    }

    if (!commitDirectScrollTop(nextScrollTop, 'custom-scrollbar-drag')) {
      setVisible(true)
      clearHideTimer()
      return
    }
    syncNow({ reveal: true, keepVisible: true })
  }

  const getPointerOverflowDirection = (
    drag: DragState,
    geometry: CustomScrollbarGeometry,
  ): 'before' | 'after' | null => {
    const trackRect = trackRef.current?.getBoundingClientRect()
    if (!trackRect || !geometry.scrollable) {
      return null
    }

    const pointerTrackY = drag.pointerY - trackRect.top
    const minThumbTop = geometry.trackStart
    const maxThumbTop =
      geometry.trackStart + Math.max(0, geometry.trackLength - geometry.thumbLength)

    if (pointerTrackY < minThumbTop) {
      return 'before'
    }

    if (pointerTrackY > maxThumbTop + geometry.thumbLength) {
      return 'after'
    }

    return null
  }

  const applyDragContinuation = () => {
    dragFrameRef.current = null
    const drag = dragStateRef.current
    if (!drag || !container) {
      return
    }

    const geometry = readGeometry()
    const direction = getPointerOverflowDirection(drag, geometry)
    if (!direction) {
      return
    }

    // 指针拖出 track 边界时仍持续写入边缘 scrollTop，让 runtime 的 edge
    // recheck 可以继续触发分页；如果本帧没有实际滚动，就停止续帧避免 storm。
    const beforeScrollTop = container.scrollTop
    writeScrollTopFromPointer(drag.pointerY, drag)

    if (Math.abs(container.scrollTop - beforeScrollTop) >= scrollWriteEpsilonPx) {
      scheduleDragContinuation()
    }
  }

  const scheduleDragContinuation = () => {
    if (dragFrameRef.current !== null) {
      return
    }

    dragFrameRef.current = window.requestAnimationFrame(applyDragContinuation)
  }

  const syncNow = (input?: SyncRequest) => {
    const geometry = readGeometry()
    applyGeometry(geometry)
    rebaseActiveDrag(geometry)
    if (dragStateRef.current) {
      scheduleDragContinuation()
    }

    if (!geometry.scrollable) {
      return
    }

    if (input?.reveal) {
      setVisible(true)
    }

    if (input?.keepVisible || dragStateRef.current || hoverRef.current) {
      clearHideTimer()
      return
    }

    if (input?.reveal) {
      scheduleHide()
    }
  }

  const mergeSyncRequest = (input?: SyncRequest) => {
    pendingSyncRef.current = {
      reveal: Boolean(pendingSyncRef.current?.reveal || input?.reveal),
      keepVisible: Boolean(
        pendingSyncRef.current?.keepVisible || input?.keepVisible,
      ),
    }
  }

  const queueSync = (input?: SyncRequest) => {
    mergeSyncRequest(input)
    if (frameRef.current !== null) {
      return
    }

    frameRef.current = -1
    const frame = window.requestAnimationFrame(() => {
      frameRef.current = null
      const request = pendingSyncRef.current
      pendingSyncRef.current = null
      syncNow(request ?? undefined)
    })
    if (frameRef.current === -1) {
      frameRef.current = frame
    }
  }

  useEffect(() => {
    containerRef.current = container
  }, [container])

  useEffect(() => {
    if (!enabled || !container) {
      setVisible(false)
      return
    }

    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null

    const handleScroll = () => {
      queueSync({ reveal: true, keepVisible: Boolean(dragStateRef.current) })
    }
    const handlePointerEnter = () => {
      setVisible(true)
      clearHideTimer()
      queueSync({ keepVisible: true })
    }
    const handlePointerLeave = () => {
      if (!dragStateRef.current) {
        scheduleHide()
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    container.addEventListener('pointerenter', handlePointerEnter)
    container.addEventListener('pointerleave', handlePointerLeave)

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        queueSync({ reveal: true, keepVisible: Boolean(dragStateRef.current) })
      })
      resizeObserver.observe(container)
      for (const child of Array.from(container.children)) {
        resizeObserver.observe(child)
      }
    }

    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        if (resizeObserver) {
          resizeObserver.disconnect()
          resizeObserver.observe(container)
          for (const child of Array.from(container.children)) {
            resizeObserver.observe(child)
          }
        }
        queueSync({ reveal: true, keepVisible: Boolean(dragStateRef.current) })
      })
      mutationObserver.observe(container, { childList: true })
    }

    queueSync()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      container.removeEventListener('pointerenter', handlePointerEnter)
      container.removeEventListener('pointerleave', handlePointerLeave)
      mutationObserver?.disconnect()
      resizeObserver?.disconnect()
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      clearDragFrame()
      clearHideTimer()
    }
  }, [container, enabled, geometryVersion])

  useLayoutEffect(() => {
    if (!enabled || !container) {
      return
    }

    syncNow({
      reveal: Boolean(dragStateRef.current),
      keepVisible: Boolean(dragStateRef.current),
    })
  }, [container, enabled, geometryVersion])

  useEffect(() => {
    if (!enabled || !container) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag || event.pointerId !== drag.pointerId) {
        return
      }

      event.preventDefault()
      drag.pointerY = event.clientY
      writeScrollTopFromPointer(event.clientY, drag)
    }

    const endDrag = (event: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag || event.pointerId !== drag.pointerId) {
        return
      }

      drag.captureElement.releasePointerCapture?.(event.pointerId)
      dragStateRef.current = null
      clearDragFrame()
      document.body.classList.remove('x-message-scrollbar-dragging')
      trackRef.current?.classList.remove('is-dragging')
      endDirectScroll('custom-scrollbar-drag')
      scheduleHide()
    }

    document.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    })
    document.addEventListener('pointerup', endDrag)
    document.addEventListener('pointercancel', endDrag)

    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', endDrag)
      document.removeEventListener('pointercancel', endDrag)
      clearDragFrame()
    }
  }, [container, enabled, runtime])

  useEffect(() => {
    return () => {
      if (dragStateRef.current) {
        dragStateRef.current = null
        clearDragFrame()
        document.body.classList.remove('x-message-scrollbar-dragging')
        trackRef.current?.classList.remove('is-dragging')
        endDirectScroll('custom-scrollbar-drag')
      }
      clearHideTimer()
    }
  }, [runtime])

  const startDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    captureElement: HTMLElement,
    grabOffset: number,
  ) => {
    if (!container || !enabled || event.button !== 0) {
      return
    }

    const geometry = readGeometry()
    if (!geometry.scrollable) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    captureElement.setPointerCapture?.(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      pointerY: event.clientY,
      grabOffset,
      captureElement,
    }
    document.body.classList.add('x-message-scrollbar-dragging')
    trackRef.current?.classList.add('is-dragging')
    setVisible(true)
    clearHideTimer()
    beginDirectScroll('custom-scrollbar-drag')
    scheduleDragContinuation()
  }

  const onThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!thumbRef.current || !trackRef.current) {
      return
    }

    const geometry = readGeometry()
    const trackRect = trackRef.current.getBoundingClientRect()
    const pointerTrackY = event.clientY - trackRect.top
    const grabOffset = Math.min(
      geometry.thumbLength,
      Math.max(0, pointerTrackY - geometry.thumbTop),
    )

    startDrag(event, thumbRef.current, grabOffset)
  }

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!container || !trackRef.current || !enabled || event.button !== 0) {
      return
    }

    const geometry = readGeometry()
    if (!geometry.scrollable) {
      return
    }

    const trackRect = trackRef.current.getBoundingClientRect()
    const clickY = event.clientY - trackRect.top
    const thumbStart = geometry.thumbTop
    const thumbEnd = thumbStart + geometry.thumbLength

    if (clickY >= thumbStart && clickY <= thumbEnd) {
      startDrag(event, trackRef.current, clickY - thumbStart)
      return
    }

    event.preventDefault()
    const viewportPage = Math.max(1, container.clientHeight - 32)
    const nextScrollTop =
      clickY < thumbStart
        ? Math.max(0, container.scrollTop - viewportPage)
        : Math.min(geometry.maxScrollTop, container.scrollTop + viewportPage)

    beginDirectScroll('custom-scrollbar-track')
    const committed = commitDirectScrollTop(nextScrollTop, 'custom-scrollbar-track')
    endDirectScroll('custom-scrollbar-track')
    if (committed) {
      syncNow({ reveal: true })
    } else {
      setVisible(true)
      clearHideTimer()
    }
  }

  const onScrollbarPointerEnter = () => {
    hoverRef.current = true
    trackRef.current?.classList.add('is-hovering')
    setVisible(true)
    clearHideTimer()
    queueSync({ keepVisible: true })
  }

  const onScrollbarPointerLeave = () => {
    hoverRef.current = false
    trackRef.current?.classList.remove('is-hovering')
    if (!dragStateRef.current) {
      scheduleHide()
    }
  }

  if (!enabled || !container) {
    return null
  }

  return (
    <>
      <style>{customScrollbarStyle}</style>
      <div
        aria-hidden="true"
        className="x-message-scrollbar"
        data-testid="custom-scrollbar"
        ref={trackRef}
        onPointerEnter={onScrollbarPointerEnter}
        onPointerLeave={onScrollbarPointerLeave}
        onPointerDown={onTrackPointerDown}
      >
        <div
          ref={thumbRef}
          className="x-message-scrollbar-thumb"
          data-testid="custom-scrollbar-thumb"
          onPointerDown={onThumbPointerDown}
        />
      </div>
    </>
  )
}
