import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type { ScrollWriterArbitration } from '../scroll/writerArbitration'
import { directScrollInputToWriterKind } from '../scroll/writerArbitration'
import type { DirectScrollInput } from '../scroll/types'
import { recordWriterIssue } from './runtimeControllerSupport'

const DIRECT_SCROLL_TRANSACTION_ID = 'direct-scroll'

type DirectScrollContext = {
  readonly writer: ScrollWriterArbitration
  readonly metrics: PhysicalMetricsStore
  readonly dom: RuntimeDomRegistry
  readonly diagnostics: DiagnosticRecorder
  readonly setCurrentScrollTop: (scrollTop: number) => void
}

export function beginDirectScrollTransaction(
  input: DirectScrollInput,
  ctx: DirectScrollContext,
): void {
  if (input.source !== 'custom-scrollbar-drag') return

  const token = {
    transactionId: DIRECT_SCROLL_TRANSACTION_ID,
    kind: directScrollInputToWriterKind(input),
  }
  if (
    ctx.dom.getContainer() === null ||
    ctx.metrics.getMetrics().physicalSegmentId === null
  ) {
    recordWriterIssue(
      ctx.diagnostics,
      'writer-arbitration',
      'direct scroll requires an attached committed segment',
    )
    return
  }
  if (!ctx.writer.acquire(token).acquired) {
    recordWriterIssue(
      ctx.diagnostics,
      'drag-lock-stolen',
      'direct scroll writer denied',
    )
    return
  }
  ctx.metrics.promote({ ...ctx.metrics.getMetrics(), isDragLocked: true })
}

export function writeDirectScrollTopWithWriter(
  scrollTop: number,
  input: DirectScrollInput,
  ctx: DirectScrollContext,
): boolean {
  const token = {
    transactionId: DIRECT_SCROLL_TRANSACTION_ID,
    kind: directScrollInputToWriterKind(input),
  }
  const metrics = ctx.metrics.getMetrics()
  if (metrics.physicalSegmentId === null) {
    recordWriterIssue(
      ctx.diagnostics,
      'writer-arbitration',
      'direct scroll write requires committed metrics',
    )
    return false
  }
  const boundedScrollTop = clampDirectScrollTop(scrollTop, {
    safeScrollRangeStart: metrics.safeScrollRangeStart,
    safeScrollRangeEnd: metrics.safeScrollRangeEnd,
    maxScrollPosition: metrics.maxScrollPosition,
  })
  const acquiredForTrack = input.source === 'custom-scrollbar-track'
    ? ctx.writer.acquire(token).acquired
    : true
  if (!acquiredForTrack) {
    recordWriterIssue(
      ctx.diagnostics,
      'writer-arbitration',
      'direct scroll write denied',
    )
    return false
  }

  const wrote = ctx.writer.writeScrollTop(
    ctx.dom.getContainer(),
    boundedScrollTop,
    token,
  )
  if (wrote) {
    ctx.setCurrentScrollTop(boundedScrollTop)
  } else {
    recordWriterIssue(
      ctx.diagnostics,
      'writer-arbitration',
      'direct scroll write denied',
    )
  }
  if (input.source === 'custom-scrollbar-track') ctx.writer.release(token)

  return wrote
}

export function endDirectScrollTransaction(
  input: DirectScrollInput,
  ctx: DirectScrollContext,
): void {
  if (input.source !== 'custom-scrollbar-drag') return

  const token = {
    transactionId: DIRECT_SCROLL_TRANSACTION_ID,
    kind: directScrollInputToWriterKind(input),
  }
  if (ctx.writer.release(token)) {
    ctx.metrics.promote({ ...ctx.metrics.getMetrics(), isDragLocked: false })
  }
}

function clampDirectScrollTop(
  scrollTop: number,
  metrics: {
    readonly safeScrollRangeStart: number
    readonly safeScrollRangeEnd: number
    readonly maxScrollPosition: number
  },
): number {
  const maxScrollPosition = toFiniteNonNegativePx(metrics.maxScrollPosition)
  const rangeStart = Math.min(
    maxScrollPosition,
    toFiniteNonNegativePx(metrics.safeScrollRangeStart),
  )
  const rangeEnd = Math.min(
    maxScrollPosition,
    Math.max(rangeStart, toFiniteNonNegativePx(metrics.safeScrollRangeEnd)),
  )
  const desired = Number.isFinite(scrollTop) ? scrollTop : rangeStart

  return Math.min(rangeEnd, Math.max(rangeStart, desired))
}

function toFiniteNonNegativePx(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
