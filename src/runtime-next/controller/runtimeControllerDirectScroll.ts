import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type { ScrollWriterArbitration } from '../scroll/writerArbitration'
import { directScrollInputToWriterKind } from '../scroll/writerArbitration'
import type { DirectScrollInput } from '../scroll/types'
import type { SegmentShiftDirection } from '../geometry/types'
import {
  resolveDirectScrollBoundary,
  type ScrollInteractionState,
} from '../scroll/interactionState'
import { recordWriterIssue } from './runtimeControllerSupport'

const DIRECT_SCROLL_TRANSACTION_ID = 'direct-scroll'

type DirectScrollContext = {
  readonly writer: ScrollWriterArbitration
  readonly metrics: PhysicalMetricsStore
  readonly dom: RuntimeDomRegistry
  readonly diagnostics: DiagnosticRecorder
  readonly scrollState: ScrollInteractionState
  readonly setCurrentScrollTop: (scrollTop: number) => void
  readonly canBuildSegmentShift: (direction: SegmentShiftDirection) => boolean
  readonly enqueueSegmentShift: (
    direction: SegmentShiftDirection,
    source: 'drag-handoff' | 'wheel',
  ) => void
  readonly deferSegmentShiftNeed: (direction: SegmentShiftDirection) => void
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
  ctx.scrollState.beginDrag()
  ctx.metrics.patchFlags(ctx.scrollState.toFlags())
  ctx.diagnostics.record({
    kind: 'transaction-lifecycle',
    severity: 'info',
    owner: 'scroll',
    message: 'scroll.direct.begin',
    details: { source: input.source },
  })
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
  if (input.source === 'custom-scrollbar-drag' && ctx.scrollState.isThumbFrozen()) {
    recordWriterIssue(
      ctx.diagnostics,
      'writer-arbitration',
      'direct scroll write rejected while thumb is frozen',
    )
    return false
  }
  const boundary = resolveDirectScrollBoundary({
    desiredScrollTop: scrollTop,
    safeScrollRangeStart: metrics.safeScrollRangeStart,
    safeScrollRangeEnd: metrics.safeScrollRangeEnd,
    maxScrollPosition: metrics.maxScrollPosition,
  })
  const boundedScrollTop = boundary.scrollTop
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
    ctx.metrics.patchScrollPosition(boundedScrollTop)
  } else {
    recordWriterIssue(
      ctx.diagnostics,
      'writer-arbitration',
      'direct scroll write denied',
    )
  }
  if (input.source === 'custom-scrollbar-track') ctx.writer.release(token)

  if (!wrote) return false

  ctx.diagnostics.record({
    kind: 'transaction-lifecycle',
    severity: 'info',
    owner: 'scroll',
    message: 'scroll.direct.write',
    details: {
      source: input.source,
      scrollTop: boundedScrollTop,
      boundary: boundary.kind,
    },
  })

  if (input.source !== 'custom-scrollbar-drag') {
    return true
  }

  if (boundary.kind === 'inside') {
    ctx.scrollState.clearEdgePending()
    ctx.metrics.patchFlags(ctx.scrollState.toFlags())
    return true
  }

  if (!ctx.canBuildSegmentShift(boundary.direction)) {
    ctx.scrollState.markEdgePending(boundary)
    ctx.metrics.patchFlags(ctx.scrollState.toFlags())
    ctx.deferSegmentShiftNeed(boundary.direction)
    return true
  }

  if (!ctx.scrollState.isSegmentShiftInFlight()) {
    ctx.scrollState.acceptDragHandoff(boundary)
    ctx.metrics.patchFlags(ctx.scrollState.toFlags())
    ctx.writer.release(token)
    ctx.diagnostics.record({
      kind: 'transaction-lifecycle',
      severity: 'info',
      owner: 'scroll',
      message: 'scroll.dragSegmentHandoff.start',
      details: {
        direction: boundary.direction,
        pendingEdgeOverflowPx: boundary.overflowPx,
      },
    })
    ctx.enqueueSegmentShift(boundary.direction, 'drag-handoff')
  }

  return false
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
  const released = ctx.writer.release(token)
  if (released || ctx.scrollState.isDragLocked()) {
    ctx.scrollState.endDrag()
    ctx.metrics.patchFlags(ctx.scrollState.toFlags())
    ctx.diagnostics.record({
      kind: 'transaction-lifecycle',
      severity: 'info',
      owner: 'scroll',
      message: 'scroll.direct.end',
      details: { source: input.source },
    })
  }
}
