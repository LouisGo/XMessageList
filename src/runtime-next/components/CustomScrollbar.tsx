import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { MessageViewportRuntime } from '../MessageViewportRuntime'
import { usePhysicalScrollMetrics } from './hooks'
import {
  computeRuntimeNextScrollbarGeometry,
  type RuntimeNextScrollbarGeometry,
} from './scrollbarGeometry'

export type RuntimeNextCustomScrollbarProps = {
  readonly runtime: MessageViewportRuntime
  readonly enabled?: boolean
}

type DragState = {
  readonly pointerId: number
  readonly grabOffset: number
  readonly trackRect: DOMRect
  readonly captureElement: HTMLElement
  readonly lastPointerY: number
}

export function RuntimeNextCustomScrollbar({
  runtime,
  enabled = true,
}: RuntimeNextCustomScrollbarProps) {
  const metrics = usePhysicalScrollMetrics(runtime)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const stableGeometryRef = useRef<RuntimeNextScrollbarGeometry | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const geometry = useMemo(
    () => computeRuntimeNextScrollbarGeometry(metrics),
    [metrics],
  )

  useLayoutEffect(() => {
    if (metrics.isThumbFrozen) {
      const frozenGeometry = stableGeometryRef.current
      if (thumbRef.current !== null && frozenGeometry !== null) {
        applyThumbGeometryStyle(thumbRef.current, frozenGeometry)
      }
      return
    }
    stableGeometryRef.current = geometry
  }, [geometry, metrics.isThumbFrozen])

  useEffect(() => {
    if (!isDragging) return

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (drag === null || event.pointerId !== drag.pointerId) return
      if (metrics.isThumbFrozen) return
      const nextDrag = {
        ...drag,
        lastPointerY: event.clientY,
      }
      dragRef.current = nextDrag
      const nextScrollTop = resolveScrollTopFromPointer(
        event.clientY,
        nextDrag,
        geometry,
      )
      runtime.writeDirectScrollTop(nextScrollTop, {
        source: 'custom-scrollbar-drag',
      })
    }
    const endDrag = (event: PointerEvent) => {
      const drag = dragRef.current
      if (drag === null || event.pointerId !== drag.pointerId) return
      drag.captureElement.releasePointerCapture?.(event.pointerId)
      dragRef.current = null
      setIsDragging(false)
      runtime.endDirectScroll({ source: 'custom-scrollbar-drag' })
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', endDrag)
    document.addEventListener('pointercancel', endDrag)

    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', endDrag)
      document.removeEventListener('pointercancel', endDrag)
    }
  }, [geometry, isDragging, metrics.isThumbFrozen, runtime])

  useEffect(() => {
    if (!isDragging || metrics.isThumbFrozen) return
    resetDragBaseline(dragRef, trackRef.current, geometry)
  }, [geometry, isDragging, metrics.isThumbFrozen])

  if (!enabled) return null

  const scrollbarClassName = [
    'x-runtime-next-scrollbar',
    geometry.scrollable ? 'is-scrollable' : '',
    isDragging ? 'is-dragging' : '',
    metrics.isThumbFrozen ? 'is-frozen' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={trackRef}
      className={scrollbarClassName}
      data-runtime-next-scrollbar
      data-testid="runtime-next-custom-scrollbar"
      style={scrollbarStyle}
      onPointerDown={(event) =>
        handleTrackPointerDown(
          event,
          geometry,
          metrics.scrollPosition,
          runtime,
        )}
    >
      <div
        ref={thumbRef}
        className="x-runtime-next-scrollbar-thumb"
        data-testid="runtime-next-custom-scrollbar-thumb"
        style={thumbStyle(geometry, metrics.isThumbFrozen)}
        onPointerDown={(event) => {
          event.stopPropagation()
          handleThumbPointerDown({
            event,
            geometry,
            track: trackRef.current,
            runtime,
            setIsDragging,
            dragRef,
          })
        }}
      />
    </div>
  )
}

function handleThumbPointerDown(input: {
  readonly event: ReactPointerEvent<HTMLDivElement>
  readonly geometry: RuntimeNextScrollbarGeometry
  readonly track: HTMLDivElement | null
  readonly runtime: MessageViewportRuntime
  readonly setIsDragging: (dragging: boolean) => void
  readonly dragRef: React.MutableRefObject<DragState | null>
}): void {
  if (!input.geometry.scrollable || input.track === null) return

  const trackRect = input.track.getBoundingClientRect()
  const grabOffset =
    input.event.clientY - trackRect.top - input.geometry.thumbTop
  input.event.currentTarget.setPointerCapture?.(input.event.pointerId)
  input.dragRef.current = {
    pointerId: input.event.pointerId,
    grabOffset,
    trackRect,
    captureElement: input.event.currentTarget,
    lastPointerY: input.event.clientY,
  }
  input.setIsDragging(true)
  input.runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
}

function resetDragBaseline(
  dragRef: React.MutableRefObject<DragState | null>,
  track: HTMLDivElement | null,
  geometry: RuntimeNextScrollbarGeometry,
): void {
  const drag = dragRef.current
  if (drag === null || track === null || !geometry.scrollable) return
  const trackRect = track.getBoundingClientRect()
  dragRef.current = {
    ...drag,
    trackRect,
    grabOffset: drag.lastPointerY - trackRect.top - geometry.thumbTop,
  }
}

function handleTrackPointerDown(
  event: ReactPointerEvent<HTMLDivElement>,
  geometry: RuntimeNextScrollbarGeometry,
  currentScrollTop: number,
  runtime: MessageViewportRuntime,
): void {
  if (!geometry.scrollable) return
  const trackRect = event.currentTarget.getBoundingClientRect()
  const pointerTrackY = event.clientY - trackRect.top
  const pageDelta = geometry.trackLength * 0.85
  const nextScrollTop = pointerTrackY < geometry.thumbTop
    ? Math.max(0, currentScrollTop - pageDelta)
    : Math.min(geometry.maxScrollTop, currentScrollTop + pageDelta)

  runtime.writeDirectScrollTop(nextScrollTop, {
    source: 'custom-scrollbar-track',
  })
}

function resolveScrollTopFromPointer(
  pointerY: number,
  drag: DragState,
  geometry: RuntimeNextScrollbarGeometry,
): number {
  const availableTravel = Math.max(0, geometry.trackLength - geometry.thumbLength)
  if (availableTravel === 0) return 0

  const thumbTop =
    pointerY - drag.trackRect.top - drag.grabOffset - geometry.trackStart
  const progress = Math.min(1, Math.max(0, thumbTop / availableTravel))

  return progress * geometry.maxScrollTop
}

function thumbStyle(
  geometry: RuntimeNextScrollbarGeometry,
  frozen: boolean,
): CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    left: 2,
    right: 2,
    height: geometry.thumbLength,
    transform: `translateY(${geometry.thumbTop}px)`,
    borderRadius: 999,
    background: 'rgba(42, 48, 56, 0.55)',
    willChange: 'transform',
    opacity: geometry.scrollable ? 1 : 0,
    transition: frozen ? 'none' : 'opacity 120ms ease',
  }
}

function applyThumbGeometryStyle(
  element: HTMLElement,
  geometry: RuntimeNextScrollbarGeometry,
): void {
  element.style.height = `${geometry.thumbLength}px`
  element.style.transform = `translateY(${geometry.thumbTop}px)`
  element.style.opacity = geometry.scrollable ? '1' : '0'
}

const scrollbarStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 2,
  bottom: 0,
  width: 10,
  pointerEvents: 'auto',
}
