import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react'
import type { MessageListAdapterRuntime } from '../../core/runtime/internal'
import { resolveScrollbarGeometry, TRACK_INSET_START } from './scrollbarGeometry'
import {
  EMPTY_METRICS,
  areSameMetrics,
  createDragMetricsKey,
  readMetrics,
  reportMetricMismatch,
} from './scrollbarMetrics'
import { customScrollbarStyle } from './scrollbarStyles'

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

type StyleEntry = {
  element: HTMLStyleElement
  references: number
}

const HIDE_DELAY_MS = 650
const styleEntries = new WeakMap<Document, StyleEntry>()

/**
 * 自定义滚动条只镜像原生容器指标，并通过 direct-scroll session 把拖拽意图交回 runtime。
 */
export function MessageListScrollbarOverlay<TMessage, TOptimistic>({
  containerRef,
  runtime,
  projectionRevision,
}: MessageListScrollbarOverlayProps<TMessage, TOptimistic>) {
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const [visible, setVisible] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const dragMetricsKeyRef = useRef<string | null>(null)
  const hoveringRef = useRef(false)
  const draggingRef = useRef(false)
  const dragOwnerDocumentRef = useRef<Document | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const refreshFrameRef = useRef<number | null>(null)
  const mismatchKeyRef = useRef<string | null>(null)
  const lastMismatchReportRef = useRef<number>(0)
  const lastMismatchMetricsRef = useRef<{ clientHeight: number; scrollHeight: number }>({ clientHeight: 0, scrollHeight: 0 })
  const thumbRef = useRef<HTMLDivElement>(null)
  const geometry = useMemo(() => resolveScrollbarGeometry(metrics), [metrics])
  const refresh = useCallback(() => {
    const next = readMetrics(containerRef.current)
    setMetrics((previous) => areSameMetrics(previous, next) ? previous : next)
    const lastSizes = lastMismatchMetricsRef.current
    const sizeChanged =
      next.clientHeight !== lastSizes.clientHeight ||
      next.scrollHeight !== lastSizes.scrollHeight
    const now = performance.now()
    const hasActiveMismatch = mismatchKeyRef.current !== null
    if (sizeChanged || now - lastMismatchReportRef.current > 500) {
      if (sizeChanged) {
        lastMismatchMetricsRef.current = {
          clientHeight: next.clientHeight,
          scrollHeight: next.scrollHeight,
        }
      }
      lastMismatchReportRef.current = now
      reportMetricMismatch(runtime, next, mismatchKeyRef)
    } else if (hasActiveMismatch) {
      reportMetricMismatch(runtime, next, mismatchKeyRef)
    }
  }, [containerRef, runtime])
  const cancelScheduledRefresh = useCallback(() => {
    if (refreshFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(refreshFrameRef.current)
    refreshFrameRef.current = null
  }, [])
  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === null) {
      return
    }

    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }, [])
  const showScrollbar = useCallback(() => {
    setVisible(true)
    clearHideTimer()
  }, [clearHideTimer])
  const scheduleRefreshFrame = useCallback(() => {
    if (refreshFrameRef.current !== null) {
      return
    }

    refreshFrameRef.current = window.requestAnimationFrame(() => {
      refreshFrameRef.current = null
      refresh()
    })
  }, [refresh])
  const scheduleRefresh = useCallback((reveal = false) => {
    if (reveal) {
      showScrollbar()
    }

    scheduleRefreshFrame()
  }, [scheduleRefreshFrame, showScrollbar])
  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null

      if (!hoveringRef.current && !draggingRef.current) {
        setVisible(false)
      }
    }, HIDE_DELAY_MS)
  }, [clearHideTimer])
  const setDraggingState = useCallback((nextDragging: boolean) => {
    draggingRef.current = nextDragging
    setDragging(nextDragging)
    const ownerDocument = containerRef.current?.ownerDocument ?? document
    dragOwnerDocumentRef.current = nextDragging ? ownerDocument : null
    ownerDocument.body.classList.toggle(
      'x-message-scrollbar-dragging',
      nextDragging,
    )
  }, [containerRef])

  useLayoutEffect(() => {
    const ownerDocument = containerRef.current?.ownerDocument

    if (!ownerDocument) {
      return
    }

    return retainCustomScrollbarStyle(ownerDocument)
  }, [containerRef])

  useLayoutEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const scheduleRefreshAndReveal = () => {
      scheduleRefresh(true)
    }
    const handleContainerPointerEnter = () => {
      showScrollbar()
      scheduleRefresh()
    }
    const handleContainerPointerLeave = () => {
      if (!draggingRef.current) {
        scheduleHide()
      }
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleRefreshAndReveal)
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(scheduleRefreshAndReveal)

    scheduleRefreshFrame()
    container.addEventListener('scroll', scheduleRefreshAndReveal, { passive: true })
    container.addEventListener('pointerenter', handleContainerPointerEnter)
    container.addEventListener('pointerleave', handleContainerPointerLeave)
    resizeObserver?.observe(container)
    mutationObserver?.observe(container, {
      childList: true,
      subtree: true,
    })

    return () => {
      cancelScheduledRefresh()
      container.removeEventListener('scroll', scheduleRefreshAndReveal)
      container.removeEventListener('pointerenter', handleContainerPointerEnter)
      container.removeEventListener('pointerleave', handleContainerPointerLeave)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [
    cancelScheduledRefresh,
    containerRef,
    scheduleHide,
    scheduleRefresh,
    scheduleRefreshFrame,
    showScrollbar,
  ])

  useLayoutEffect(() => {
    scheduleRefreshFrame()
  }, [projectionRevision, scheduleRefreshFrame])

  useLayoutEffect(() => {
    return () => {
      clearHideTimer()
      if (dragRef.current) {
        dragRef.current = null
        dragMetricsKeyRef.current = null
        runtime.endDirectScroll()
      }
      draggingRef.current = false
      dragOwnerDocumentRef.current?.body.classList.remove(
        'x-message-scrollbar-dragging',
      )
      dragOwnerDocumentRef.current = null
    }
  }, [clearHideTimer, runtime])

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

    // projection 期间内容高度可能变化；拖拽基准要重建，避免 thumb 跳动放大成错误 scrollTop。
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
    if (
      event.button !== 0 ||
      event.target !== event.currentTarget ||
      !geometry.visible
    ) {
      return
    }

    event.preventDefault()
    showScrollbar()
    const rect = event.currentTarget.getBoundingClientRect()
    const targetThumbTop =
      event.clientY - rect.top - geometry.trackStart - geometry.thumbHeight / 2
    const maxThumbTop = Math.max(1, geometry.maxThumbTop)
    const ratio = Math.min(Math.max(targetThumbTop / maxThumbTop, 0), 1)

    runtime.beginDirectScroll()
    writeScrollTop(ratio * geometry.maxScrollTop)
    runtime.endDirectScroll()
    scheduleHide()
  }, [geometry, runtime, scheduleHide, showScrollbar, writeScrollTop])

  const handleThumbPointerDown = useCallback((
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0 || !geometry.visible) {
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
    setDraggingState(true)
    showScrollbar()
    runtime.beginDirectScroll()
  }, [
    geometry,
    metrics,
    projectionRevision,
    runtime,
    setDraggingState,
    showScrollbar,
  ])

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
    const scrollTop = Math.min(
      Math.max(drag.startScrollTop + scrollDelta, 0),
      drag.maxScrollTop,
    )

    runtime.writeDirectScrollTop(scrollTop)

    // Direct DOM write for thumb position — bypasses React render during drag.
    if (thumbRef.current) {
      const thumbTop = drag.maxScrollTop > 0
        ? TRACK_INSET_START + (scrollTop / drag.maxScrollTop) * drag.maxThumbTop
        : TRACK_INSET_START
      thumbRef.current.style.transform = `translate3d(0, ${thumbTop}px, 0)`
    }

    // Schedule RAF-batched refresh for telemetry sync (no-op if already pending).
    scheduleRefreshFrame()
  }, [runtime, scheduleRefreshFrame])

  const endDrag = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null
      dragMetricsKeyRef.current = null
      setDraggingState(false)
      runtime.endDirectScroll()
      refresh()
      scheduleHide()
    }
  }, [refresh, runtime, scheduleHide, setDraggingState])

  const handleScrollbarPointerEnter = useCallback(() => {
    hoveringRef.current = true
    setHovering(true)
    showScrollbar()
  }, [showScrollbar])

  const handleScrollbarPointerLeave = useCallback(() => {
    hoveringRef.current = false
    setHovering(false)

    if (!draggingRef.current) {
      scheduleHide()
    }
  }, [scheduleHide])

  const scrollbarClassName = useMemo(() => [
    'x-message-scrollbar',
    geometry.visible ? 'is-scrollable' : null,
    visible ? 'is-visible' : null,
    hovering ? 'is-hovering' : null,
    dragging ? 'is-dragging' : null,
  ].filter(Boolean).join(' '), [geometry.visible, visible, hovering, dragging])

  return (
    <div
      aria-hidden="true"
      className={scrollbarClassName}
      data-message-scrollbar-overlay
      data-message-scrollbar-track
      data-testid="custom-scrollbar"
      onPointerDown={handleTrackPointerDown}
      onPointerEnter={handleScrollbarPointerEnter}
      onPointerLeave={handleScrollbarPointerLeave}
    >
      <div
        ref={thumbRef}
        className="x-message-scrollbar-thumb"
        data-message-scrollbar-thumb
        data-testid="custom-scrollbar-thumb"
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        style={{
          height: geometry.thumbHeight,
          transform: `translate3d(0, ${geometry.thumbTop}px, 0)`,
        }}
      />
    </div>
  )
}

function retainCustomScrollbarStyle(ownerDocument: Document): () => void {
  const current = styleEntries.get(ownerDocument)

  if (current) {
    current.references += 1
    return () => {
      releaseCustomScrollbarStyle(ownerDocument)
    }
  }

  const element = ownerDocument.createElement('style')
  element.textContent = customScrollbarStyle
  ownerDocument.head.appendChild(element)
  styleEntries.set(ownerDocument, {
    element,
    references: 1,
  })

  return () => {
    releaseCustomScrollbarStyle(ownerDocument)
  }
}

function releaseCustomScrollbarStyle(ownerDocument: Document): void {
  const current = styleEntries.get(ownerDocument)

  if (!current) {
    return
  }

  current.references -= 1

  if (current.references > 0) {
    return
  }

  current.element.remove()
  styleEntries.delete(ownerDocument)
}
