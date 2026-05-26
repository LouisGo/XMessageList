import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
  type RefObject,
} from 'react'
import type { MessageListAdapterRuntime } from '../runtime/internal'

type NativeScrollMetrics = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

type DragState = {
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

const EMPTY_METRICS: NativeScrollMetrics = {
  scrollTop: 0,
  clientHeight: 0,
  scrollHeight: 0,
}
const MIN_THUMB_SIZE = 28
const METRIC_MISMATCH_TOLERANCE = 2

export function MessageListScrollbarOverlay<TMessage, TOptimistic>({
  containerRef,
  runtime,
  projectionRevision,
}: MessageListScrollbarOverlayProps<TMessage, TOptimistic>) {
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const dragRef = useRef<DragState | null>(null)
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
      startY: event.clientY,
      startScrollTop: metrics.scrollTop,
      maxScrollTop: geometry.maxScrollTop,
      maxThumbTop: geometry.maxThumbTop,
    }
    runtime.beginDirectScroll()
  }, [geometry, metrics.scrollTop, runtime])

  const handleThumbPointerMove = useCallback((
    event: PointerEvent<HTMLDivElement>,
  ) => {
    const drag = dragRef.current

    if (!drag) {
      return
    }

    event.preventDefault()
    const scrollDelta = drag.maxThumbTop > 0
      ? ((event.clientY - drag.startY) / drag.maxThumbTop) * drag.maxScrollTop
      : 0
    writeScrollTop(Math.min(Math.max(drag.startScrollTop + scrollDelta, 0), drag.maxScrollTop))
  }, [writeScrollTop])

  const endDrag = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null
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

function readMetrics(container: HTMLElement | null): NativeScrollMetrics {
  if (!container) {
    return EMPTY_METRICS
  }

  return {
    scrollTop: container.scrollTop,
    clientHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
  }
}

function resolveScrollbarGeometry(metrics: NativeScrollMetrics) {
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  const visible = metrics.clientHeight > 0 && maxScrollTop > 1
  const trackHeight = Math.max(0, metrics.clientHeight)
  const rawThumbHeight = metrics.scrollHeight > 0
    ? (metrics.clientHeight / metrics.scrollHeight) * trackHeight
    : trackHeight
  const thumbHeight = visible
    ? Math.min(trackHeight, Math.max(MIN_THUMB_SIZE, rawThumbHeight))
    : trackHeight
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const thumbTop = maxScrollTop > 0
    ? (metrics.scrollTop / maxScrollTop) * maxThumbTop
    : 0

  return {
    visible,
    maxScrollTop,
    thumbHeight,
    thumbTop,
    maxThumbTop,
  }
}

function reportMetricMismatch<TMessage, TOptimistic>(
  runtime: MessageListAdapterRuntime<TMessage, TOptimistic>,
  metrics: NativeScrollMetrics,
  lastMismatchKey: MutableRefObject<string | null>,
): void {
  const evidence = runtime.getEvidence()
  const clientHeightDelta = Math.abs(evidence.clientHeight - metrics.clientHeight)
  const scrollHeightDelta = Math.abs(evidence.scrollHeight - metrics.scrollHeight)

  if (
    clientHeightDelta > METRIC_MISMATCH_TOLERANCE ||
    scrollHeightDelta > METRIC_MISMATCH_TOLERANCE
  ) {
    const mismatchKey = [
      clientHeightDelta,
      scrollHeightDelta,
      metrics.clientHeight,
      metrics.scrollHeight,
    ].join(':')

    if (lastMismatchKey.current === mismatchKey) {
      return
    }

    lastMismatchKey.current = mismatchKey
    runtime.reportOverlayMetricMismatch({
      clientHeightDelta,
      scrollHeightDelta,
      evidenceClientHeight: evidence.clientHeight,
      evidenceScrollHeight: evidence.scrollHeight,
      overlayClientHeight: metrics.clientHeight,
      overlayScrollHeight: metrics.scrollHeight,
    })
    return
  }

  lastMismatchKey.current = null
}

function areSameMetrics(left: NativeScrollMetrics, right: NativeScrollMetrics): boolean {
  return left.scrollTop === right.scrollTop &&
    left.clientHeight === right.clientHeight &&
    left.scrollHeight === right.scrollHeight
}

const overlayStyle = {
  bottom: 0,
  pointerEvents: 'none',
  position: 'absolute',
  right: 6,
  top: 0,
  width: 12,
  zIndex: 4,
} as const

const trackStyle = {
  height: '100%',
  pointerEvents: 'auto',
  position: 'relative',
  width: '100%',
} as const

const thumbStyle = {
  background: 'rgb(45 65 72 / 0.46)',
  border: '2px solid rgb(255 255 255 / 0.7)',
  borderRadius: 999,
  boxSizing: 'border-box',
  minHeight: MIN_THUMB_SIZE,
  position: 'absolute',
  right: 0,
  top: 0,
  width: 12,
} as const
