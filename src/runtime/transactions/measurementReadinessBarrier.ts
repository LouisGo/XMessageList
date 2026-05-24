import type {
  MessageDataSnapshot,
  MessageRuntimeItemKey,
  RenderWindow,
  ViewportTransactionKind,
} from '../types'
import type { MeasurableRow } from '../core/state/runtimeTypes'
import type { ViewportTransactionDeps } from './viewportTransactionController'

export function resolveMeasuredTarget<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    targetKey: MessageRuntimeItemKey
    targetIndex: number
    renderWindow: RenderWindow
    missingDomErrorCode: string
    transactionKind: ViewportTransactionKind
  },
): MeasurableRow | Promise<MeasurableRow | null> {
  const direct = deps.anchor.getDirectMeasurableRow(input.targetKey)

  if (direct) {
    emitMeasuredTargetReadiness(deps, input, direct)
    return direct
  }

  return deps.anchor.resolveMeasurableRowForTarget({
    data: input.data,
    targetKey: input.targetKey,
    targetIndex: input.targetIndex,
    renderWindow: input.renderWindow,
    missingDomErrorCode: input.missingDomErrorCode,
  }).then((resolved) => {
    emitMeasuredTargetReadiness(deps, input, resolved)
    return resolved
  })
}

function emitMeasuredTargetReadiness<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    targetKey: MessageRuntimeItemKey
    targetIndex: number
    renderWindow: RenderWindow
    missingDomErrorCode: string
    transactionKind: ViewportTransactionKind
  },
  resolved: MeasurableRow | null,
): void {
  const measuredCount = deps.measureCurrentWindow().length

  deps.emitDiagnostic({
    channel: 'measurement',
    severity: resolved ? 'debug' : 'warn',
    name: 'measurement.readiness',
    correlationId:
      `data:${input.data.feedId}:${input.data.generation}:${input.data.revision}`,
    details: () => ({
      phase: 'target',
      transactionKind: input.transactionKind,
      targetKey: input.targetKey,
      targetIndex: input.targetIndex,
      targetResolved: Boolean(resolved),
      measuredCount,
    }),
  })
}
