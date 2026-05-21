import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type { SegmentShiftDirection } from '../geometry/types'
import { ScrollInteractionState } from '../scroll/interactionState'

export type RuntimeWheelBoundaryContext = {
  readonly getDestroyed: () => boolean
  readonly metrics: PhysicalMetricsStore
  readonly scrollState: ScrollInteractionState
  readonly diagnostics: DiagnosticRecorder
  readonly canBuildSegmentShift: (direction: SegmentShiftDirection) => boolean
  readonly enqueueSegmentShift: (direction: SegmentShiftDirection) => void
  readonly deferSegmentShiftNeed: (direction: SegmentShiftDirection) => void
}

export function handleWheelBoundaryEvent(
  event: WheelEvent,
  ctx: RuntimeWheelBoundaryContext,
): boolean {
  if (ctx.getDestroyed() || event.deltaY === 0) return false
  const direction: SegmentShiftDirection = event.deltaY < 0 ? 'before' : 'after'
  const metrics = ctx.metrics.getMetrics()
  if (metrics.physicalSegmentId === null) return false

  const atBoundary = direction === 'before'
    ? metrics.scrollPosition <= metrics.safeScrollRangeStart
    : metrics.scrollPosition >= metrics.safeScrollRangeEnd
  if (ctx.scrollState.isMomentumLatched()) {
    if (ctx.scrollState.getMomentumLatchDirection() === direction) {
      ctx.scrollState.suppressMomentumDelta({ direction, deltaPx: event.deltaY })
      ctx.metrics.patchFlags(ctx.scrollState.toFlags())
      ctx.diagnostics.record({
        kind: 'momentum-residual-shift-loop',
        severity: 'info',
        owner: 'scroll',
        message: 'scroll.momentum.suppressDelta',
        details: { direction, deltaY: event.deltaY },
      })
      return true
    }

    // macOS bounce can send reverse deltas while the old latch is active.
    // It must clamp in-place instead of becoming a second cross-segment shift.
    releaseMomentumIfLatched(ctx, 'reverse-boundary-delta')
    return atBoundary
  }

  if (!atBoundary) return false

  ctx.scrollState.latchMomentum({ direction, deltaPx: event.deltaY })
  ctx.metrics.patchFlags(ctx.scrollState.toFlags())
  ctx.diagnostics.record({
    kind: 'transaction-lifecycle',
    severity: 'info',
    owner: 'scroll',
    message: 'scroll.momentum.latch',
    details: { direction, deltaY: event.deltaY },
  })
  if (ctx.canBuildSegmentShift(direction)) {
    ctx.enqueueSegmentShift(direction)
  } else {
    ctx.deferSegmentShiftNeed(direction)
  }

  return true
}

function releaseMomentumIfLatched(
  ctx: RuntimeWheelBoundaryContext,
  reason: string,
): void {
  if (!ctx.scrollState.isMomentumLatched()) return
  const direction = ctx.scrollState.getMomentumLatchDirection()
  ctx.scrollState.releaseMomentumLatch()
  ctx.metrics.patchFlags(ctx.scrollState.toFlags())
  ctx.diagnostics.record({
    kind: 'transaction-lifecycle',
    severity: 'info',
    owner: 'scroll',
    message: 'scroll.momentum.release',
    details: { direction, reason },
  })
}
