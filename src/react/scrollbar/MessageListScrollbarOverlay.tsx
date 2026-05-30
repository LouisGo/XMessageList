import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react'
import type { MessageListAdapterRuntime } from '../../runtime/internal'
import { resolveScrollbarGeometry } from './scrollbarGeometry'
import {
  EMPTY_METRICS,
  areSameMetrics,
  createDragMetricsKey,
  readMetrics,
  reportMetricMismatch,
} from './scrollbarMetrics'
import { overlayStyle, thumbStyle, trackStyle } from './scrollbarStyles'

type DragState = {
  lastPointerY: number
  startY: number
  startScrollTop: number
  maxScrollTop: number
  maxThumbTop: number
}

export type MessageListScrollbarOverlayProps<TMessage, TOptimistic> = {
  containerRef: RefObject<HTMLElement>
  runtime: MessageListAdapterRuntime<TMessage, TOptimistic>
  projectionRevision: number
}

export function MessageListScrollbarOverlay<TMessage, TOptimistic>({
  containerRef,
  runtime,
  projectionRevision,
}: MessageListScrollbarOverlayProps<TMessage, TOptimistic>) {
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const dragRef = useRef<DragState | null>(null)
  const dragMetricsKeyRef = useRef<string | null>(null)
  const mismatchKeyRef = useRef<string | null>(null)
  const geometry = useMemo(() => resolveScrollbarGeometry(metrics), [metrics])
  const refresh = useCallback(() => {
    const next = readMetrics(containerRef.current)
    setMetrics((previous) => areSameMetrics(previous, next) ? previous : next)
    reportMetricMismatch(runtime, next, mismatchKeyRef)
  }, [containerRef, runtime])

  useLayoutEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    let frame: number | null = null
    const scheduleRefresh = () => {
      if (frame !== null) {
        return
      }
      frame = window.requestAnimationFrame(() => {
        frame = null
        refresh()
      })
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleRefresh)
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(scheduleRefresh)

    scheduleRefresh()
    container.addEventListener('scroll', scheduleRefresh, { passive: true })
    resizeObserver?.observe(container)
    mutationObserver?.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
    })

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      container.removeEventListener('scroll', scheduleRefresh)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [containerRef, projectionRevision, refresh])

  const writeScrollTop = useCallback((scrollTop: number) => {
    runtime.writeDirectScrollTop(scrollTop)
    refresh()
  }, [refresh, runtime])

  useLayoutEffect(() => {
    const drag = dragRef.current

    if (!drag) {
      return
    }

    const nextMetrics = readMetrics(containerRef.current)
    const nextGeometry = resolveScrollbarGeometry(nextMetrics)
    const metricsKey = createDragMetricsKey(projectionRevision, nextMetrics)

    if (dragMetricsKeyRef.current === null) {
      dragMetricsKeyRef.current = metricsKey
      return
    }

    if (dragMetricsKeyRef.current === metricsKey) {
      return
    }

    dragRef.current = {
      lastPointerY: drag.lastPointerY,
      startY: drag.lastPointerY,
      startScrollTop: nextMetrics.scrollTop,
      maxScrollTop: nextGeometry.maxScrollTop,
      maxThumbTop: nextGeometry.maxThumbTop,
    }
    dragMetricsKeyRef.current = metricsKey
    setMetrics((previous) =>
      areSameMetrics(previous, nextMetrics) ? previous : nextMetrics
    )
    runtime.notifyDirectScrollRebased()
  }, [
    containerRef,
    metrics,
    projectionRevision,
    runtime,
  ])

  const handleTrackPointerDown = useCallback((
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget || !geometry.visible) {
      return
    }

    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const trackHeight = rect.height || metrics.clientHeight
    const maxThumbTop = Math.max(1, trackHeight - geometry.thumbHeight)
    const targetThumbTop = event.clientY - rect.top - geometry.thumbHeight / 2
    const ratio = Math.min(Math.max(targetThumbTop / maxThumbTop, 0), 1)

    runtime.beginDirectScroll()
    writeScrollTop(ratio * geometry.maxScrollTop)
    runtime.endDirectScroll()
  }, [geometry, metrics.clientHeight, runtime, writeScrollTop])

  const handleThumbPointerDown = useCallback((
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (!geometry.visible) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      lastPointerY: event.clientY,
      startY: event.clientY,
      startScrollTop: metrics.scrollTop,
      maxScrollTop: geometry.maxScrollTop,
      maxThumbTop: geometry.maxThumbTop,
    }
    dragMetricsKeyRef.current = createDragMetricsKey(
      projectionRevision,
      metrics,
    )
    runtime.beginDirectScroll()
  }, [geometry, metrics, projectionRevision, runtime])

  const handleThumbPointerMove = useCallback((
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const drag = dragRef.current

    if (!drag) {
      return
    }

    event.preventDefault()
    drag.lastPointerY = event.clientY
    const scrollDelta = drag.maxThumbTop > 0
      ? ((event.clientY - drag.startY) / drag.maxThumbTop) * drag.maxScrollTop
      : 0
    writeScrollTop(Math.min(Math.max(drag.startScrollTop + scrollDelta, 0), drag.maxScrollTop))
  }, [writeScrollTop])

  const endDrag = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null
      dragMetricsKeyRef.current = null
      runtime.endDirectScroll()
    }
  }, [runtime])

  return (
    <div
      aria-hidden="true"
      data-message-scrollbar-overlay
      data-visible={geometry.visible ? 'true' : 'false'}
      style={overlayStyle}
    >
      <div
        data-message-scrollbar-track
        onPointerDown={handleTrackPointerDown}
        style={trackStyle}
      >
        <div
          data-message-scrollbar-thumb
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            ...thumbStyle,
            height: geometry.thumbHeight,
            transform: `translateY(${geometry.thumbTop}px)`,
          }}
        />
      </div>
    </div>
  )
}
