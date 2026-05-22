import type {
  RuntimeScheduler,
  ScrollMotionOptions,
  ScrollSource,
} from '../types'
import type { RuntimeDiagnosticEmitter } from '../core/state/runtimeTypes'
import {
  ScrollMotionEngine,
  type ScrollMotionCancelReason,
  type ScrollMotionSource,
} from './scrollMotionEngine'

export function startDestinationScrollMotion(input: {
  motionEngine: ScrollMotionEngine
  container: HTMLElement
  source: ScrollMotionSource
  targetTop: number
  options: Required<ScrollMotionOptions>
  allowPreposition?: boolean
  scheduler: RuntimeScheduler
  correlationId: string
  writeScrollTop: (scrollTop: number, source: ScrollSource) => void
  settle: () => void
  cancel: (reason: ScrollMotionCancelReason) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}): void {
  input.motionEngine.start({
    container: input.container,
    source: input.source,
    targetTop: input.targetTop,
    maxDistancePx: input.options.maxDistancePx,
    minDurationMs: input.options.minDurationMs,
    maxDurationMs: input.options.maxDurationMs,
    targetEpsilonPx: input.options.targetEpsilonPx,
    allowPreposition: input.allowPreposition,
    now: () => input.scheduler.now(),
    requestFrame: (callback) => input.scheduler.requestAnimationFrame(callback),
    cancelFrame: (handle) => input.scheduler.cancelAnimationFrame(handle),
    onFrameWrite: input.writeScrollTop,
    onSettle: input.settle,
    onCancel: input.cancel,
    onDecision: (decision) =>
      input.emitDiagnostic({
        channel: 'motion',
        severity: 'debug',
        name: 'scrollMotion.decision',
        correlationId: input.correlationId,
        details: () => ({
          source: input.source,
          ...decision,
        }),
      }),
  })
}
