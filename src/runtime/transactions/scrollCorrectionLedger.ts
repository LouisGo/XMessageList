import type {
  MessageDataSnapshot,
  MessageRuntimeItemKey,
  RenderWindow,
  ScrollSource,
} from '../types'
import type { MeasurableRow, RestoreTarget } from '../core/state/runtimeTypes'
import type { ViewportTransactionDeps } from './viewportTransactionController'

const SCROLL_CORRECTION_EPSILON_PX = 0.5

export type MissingAnchorAfterPolicy =
  | 'return'
  | 'measure-only'
  | 'fallback-align'

export type ScrollCorrectionResult =
  | { status: 'applied'; delta: number; measuredCount: number }
  | { status: 'within-epsilon'; delta: number; measuredCount: number }
  | { status: 'aligned-fallback'; delta: null; measuredCount: number }
  | { status: 'measured-only'; delta: null; measuredCount: number }
  | { status: 'missing'; delta: null; measuredCount: number }

export function captureAnchorTop<TMessage, TOptimistic>(
  deps: Pick<ViewportTransactionDeps<TMessage, TOptimistic>, 'registry'>,
  key: MessageRuntimeItemKey,
): number | null {
  const top = deps.registry.getRow(key)?.getBoundingClientRect().top
  return typeof top === 'number' ? top : null
}

export function correctPreservedAnchorAfterCommit<
  TMessage,
  TOptimistic,
>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    container: HTMLElement
    renderWindow: RenderWindow
    target: RestoreTarget
    anchorTopBefore: number | null
    missingDomErrorCode: string
    missingAnchorAfterPolicy: MissingAnchorAfterPolicy
    source?: Extract<ScrollSource, 'recovery' | 'programmatic'>
  },
): ScrollCorrectionResult | Promise<ScrollCorrectionResult> {
  const anchorTopAfter = captureAnchorTop(deps, input.target.key)

  if (
    typeof input.anchorTopBefore === 'number' &&
    typeof anchorTopAfter === 'number'
  ) {
    const measuredCount = deps.measureCurrentWindow().length
    const delta = anchorTopAfter - input.anchorTopBefore

    deps.setViewportPhase('CORRECTING')

    if (Math.abs(delta) > SCROLL_CORRECTION_EPSILON_PX) {
      deps.motion.writeScrollTop(
        input.container.scrollTop + delta,
        input.source ?? 'recovery',
      )
      const result = { status: 'applied' as const, delta, measuredCount }
      emitCorrectionDiagnostic(deps, input, result)
      return result
    }

    const result = { status: 'within-epsilon' as const, delta, measuredCount }
    emitCorrectionDiagnostic(deps, input, result)
    return result
  }

  if (input.missingAnchorAfterPolicy === 'return') {
    const result = { status: 'missing' as const, delta: null, measuredCount: 0 }
    emitCorrectionDiagnostic(deps, input, result)
    return result
  }

  const measuredCount = deps.measureCurrentWindow().length

  if (input.missingAnchorAfterPolicy === 'measure-only') {
    const result = { status: 'measured-only' as const, delta: null, measuredCount }
    emitCorrectionDiagnostic(deps, input, result)
    return result
  }

  const resolved = deps.anchor.getDirectMeasurableRow(input.target.key)

  if (!resolved) {
    return deps.anchor.resolveMeasurableRowForTarget({
      data: input.data,
      targetKey: input.target.key,
      targetIndex: input.target.index,
      renderWindow: input.renderWindow,
      missingDomErrorCode: input.missingDomErrorCode,
    }).then((fallback) =>
      alignFallbackAfterMeasurement(deps, input, fallback, measuredCount),
    )
  }

  return alignFallbackAfterMeasurement(deps, input, resolved, measuredCount)
}

function alignFallbackAfterMeasurement<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    container: HTMLElement
    target: RestoreTarget
    missingAnchorAfterPolicy: MissingAnchorAfterPolicy
  },
  resolved: MeasurableRow | null,
  measuredCount: number,
): ScrollCorrectionResult {
  if (!resolved) {
    const result = { status: 'missing' as const, delta: null, measuredCount }
    emitCorrectionDiagnostic(deps, input, result)
    return result
  }

  deps.setViewportPhase('CORRECTING')
  deps.anchor.alignToResolvedRestoreTarget(input.container, input.target, resolved)

  const result = {
    status: 'aligned-fallback' as const,
    delta: null,
    measuredCount,
  }
  emitCorrectionDiagnostic(deps, input, result)
  return result
}

function emitCorrectionDiagnostic<TMessage, TOptimistic>(
  deps: Pick<ViewportTransactionDeps<TMessage, TOptimistic>, 'emitDiagnostic'>,
  input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    target: RestoreTarget
    missingAnchorAfterPolicy: MissingAnchorAfterPolicy
  },
  result: ScrollCorrectionResult,
): void {
  deps.emitDiagnostic({
    channel: 'recovery',
    severity: result.status === 'missing' ? 'warn' : 'debug',
    name: 'correction.anchorPreserved',
    correlationId:
      `data:${input.data.feedId}:${input.data.generation}:${input.data.revision}`,
    details: () => ({
      status: result.status,
      delta: result.delta,
      measuredCount: result.measuredCount,
      targetKey: input.target.key,
      targetIndex: input.target.index,
      missingAnchorAfterPolicy: input.missingAnchorAfterPolicy,
    }),
  })
}
