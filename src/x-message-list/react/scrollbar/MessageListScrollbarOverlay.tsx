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
  areSameMetricRange,
  createDragMetricsKey,
  readMetrics,
  reportMetricMismatch,
  type NativeScrollMetrics,
} from './scrollbarMetrics'
import { customScrollbarStyle } from './scrollbarStyles'
import { useRafCallback } from '../hooks/useRafCallback'
import { useTimeoutHandle } from '../hooks/useTimeoutHandle'

type DragState = {
  lastPointerY: number
  startY: number
  startScrollTop: number
  maxScrollTop: number
  maxThumbTop: number
}

type OverlayRefreshReason = 'scroll' | 'projection' | 'resize' | 'mutation' | 'drag'

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
  const refreshReasonRef = useRef<Set<OverlayRefreshReason>>(new Set())
  const mutationBatchRef = useRef(0)
  const mismatchKeyRef = useRef<string | null>(null)
  const lastMismatchReportRef = useRef<number>(0)
  const lastMismatchMetricsRef = useRef<{ clientHeight: number; scrollHeight: number }>({ clientHeight: 0, scrollHeight: 0 })
  const thumbRef = useRef<HTMLDivElement>(null)
  const hideTimer = useTimeoutHandle()
  const geometry = useMemo(() => resolveScrollbarGeometry(metrics), [metrics])
  const applyThumbTransform = useCallback((nextMetrics: NativeScrollMetrics) => {
    const nextGeometry = resolveScrollbarGeometry(nextMetrics)

    if (!thumbRef.current) {
      return nextGeometry
    }

    thumbRef.current.style.transform = `translate3d(0, ${nextGeometry.thumbTop}px, 0)`
    return nextGeometry
  }, [])
  const refresh = useCallback((reason: OverlayRefreshReason) => {
    const readStartedAt = performance.now()
    const next = readMetrics(containerRef.current)
    const layoutReadMs = performance.now() - readStartedAt
    applyThumbTransform(next)
    setMetrics((previous) =>
      areSameMetricRange(previous, next) ? previous : next
    )
    runtime.reportOverlayDiagnostic?.('overlay.refresh.count', {
      reason,
      layoutReadMs,
      scrollTop: next.scrollTop,
      clientHeight: next.clientHeight,
      scrollHeight: next.scrollHeight,
    })
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
  }, [applyThumbTransform, containerRef, runtime])
  const refreshFrame = useRafCallback(() => {
    const reasons = [...refreshReasonRef.current]
    refreshReasonRef.current.clear()
    if (reasons.includes('mutation') && mutationBatchRef.current > 0) {
      runtime.reportOverlayDiagnostic?.('overlay.mutation.batch', {
        records: mutationBatchRef.current,
      })
      mutationBatchRef.current = 0
    }
    refresh(reasons[0] ?? 'scroll')
  })
  const showScrollbar = useCallback(() => {
    setVisible(true)
    hideTimer.clear()
  }, [hideTimer])
  const scheduleRefreshFrame = useCallback((reason: OverlayRefreshReason) => {
    refreshReasonRef.current.add(reason)
    refreshFrame.schedule()
  }, [refreshFrame])
  const scheduleRefresh = useCallback((
    reason: OverlayRefreshReason,
    reveal = false,
  ) => {
    if (reveal) {
      showScrollbar()
    }

    scheduleRefreshFrame(reason)
  }, [scheduleRefreshFrame, showScrollbar])
  const scheduleHide = useCallback(() => {
    hideTimer.set(() => {
      if (!hoveringRef.current && !draggingRef.current) {
        setVisible(false)
      }
    }, HIDE_DELAY_MS)
  }, [hideTimer])
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

    const scheduleScrollRefreshAndReveal = () => {
      scheduleRefresh('scroll', true)
    }
    const scheduleResizeRefreshAndReveal = () => {
      scheduleRefresh('resize', true)
    }
    const scheduleMutationRefreshAndReveal = (records: MutationRecord[]) => {
      mutationBatchRef.current += records.length
      scheduleRefresh('mutation', true)
    }
    const handleContainerPointerEnter = () => {
      showScrollbar()
      scheduleRefresh('scroll')
    }
    const handleContainerPointerLeave = () => {
      if (!draggingRef.current) {
        scheduleHide()
      }
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleResizeRefreshAndReveal)
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(scheduleMutationRefreshAndReveal)
    const flow = container.querySelector<HTMLElement>('[data-message-flow]')

    scheduleRefreshFrame('projection')
    container.addEventListener('scroll', scheduleScrollRefreshAndReveal, { passive: true })
    container.addEventListener('pointerenter', handleContainerPointerEnter)
    container.addEventListener('pointerleave', handleContainerPointerLeave)
    resizeObserver?.observe(container)
    mutationObserver?.observe(flow ?? container, {
      childList: true,
      subtree: !flow,
    })

    return () => {
      refreshFrame.cancel()
      container.removeEventListener('scroll', scheduleScrollRefreshAndReveal)
      container.removeEventListener('pointerenter', handleContainerPointerEnter)
      container.removeEventListener('pointerleave', handleContainerPointerLeave)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [
    containerRef,
    refreshFrame,
    scheduleHide,
    scheduleRefresh,
    scheduleRefreshFrame,
    showScrollbar,
  ])

  useLayoutEffect(() => {
    scheduleRefreshFrame('projection')
  }, [projectionRevision, scheduleRefreshFrame])

  useLayoutEffect(() => {
    return () => {
      hideTimer.clear()
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
  }, [hideTimer, runtime])

  const writeScrollTop = useCallback((scrollTop: number) => {
    runtime.writeDirectScrollTop(scrollTop)
    refresh('drag')
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
    applyThumbTransform(nextMetrics)
    setMetrics((previous) =>
      areSameMetricRange(previous, nextMetrics) ? previous : nextMetrics
    )
    runtime.notifyDirectScrollRebased()
    runtime.reportOverlayDiagnostic?.('overlay.drag.rebase.count', {
      projectionRevision,
    })
  }, [
    applyThumbTransform,
    containerRef,
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
    const nextMetrics = readMetrics(containerRef.current)
    const nextGeometry = resolveScrollbarGeometry(nextMetrics)

    if (event.button !== 0 || !nextGeometry.visible) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    applyThumbTransform(nextMetrics)
    setMetrics((previous) =>
      areSameMetricRange(previous, nextMetrics) ? previous : nextMetrics
    )
    dragRef.current = {
      lastPointerY: event.clientY,
      startY: event.clientY,
      startScrollTop: nextMetrics.scrollTop,
      maxScrollTop: nextGeometry.maxScrollTop,
      maxThumbTop: nextGeometry.maxThumbTop,
    }
    dragMetricsKeyRef.current = createDragMetricsKey(
      projectionRevision,
      nextMetrics,
    )
    setDraggingState(true)
    showScrollbar()
    runtime.beginDirectScroll()
  }, [
    applyThumbTransform,
    containerRef,
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
    scheduleRefreshFrame('drag')
  }, [runtime, scheduleRefreshFrame])

  const endDrag = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null
      dragMetricsKeyRef.current = null
      setDraggingState(false)
      runtime.endDirectScroll()
      refresh('drag')
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
