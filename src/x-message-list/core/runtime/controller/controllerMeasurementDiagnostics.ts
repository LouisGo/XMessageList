import type { ViewportDiagnosticRecord } from '../contracts/events'
import type { LoadedSegment, SegmentModifier } from '../contracts/segment'
import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeDirtyRange, RuntimeDirtyRangeRegistry } from '../dom/dirtyRange'
import { measureRuntimeDom, type RuntimeMeasurement } from '../dom/measurement'
import { resolveTransactionPreCorrectionMeasurementPlan, type TransactionPreCorrectionMeasurementPlan } from './controllerPreCorrectionMeasurement'
import type { PendingTransaction } from './controllerTransactionHelpers'
import type { RuntimeMeasurementSource } from './controllerMeasurement'

export type PushDiagnostic = (
  name: string,
  severity: ViewportDiagnosticRecord['severity'],
  details: Record<string, unknown>,
) => void

export type RuntimeMeasurementDiagnosticContext = {
  sessionId?: string
  generation?: number
  segmentRevision?: number
  projectionRevision?: number
  modifier?: SegmentModifier['type']
  transactionPhase?: 'precheck' | 'final'
  measurementPlan?: string
  fullMeasureReason?: string
  anchorSource?: string
  dirtyReason?: RuntimeDirtyRange['reason']
  dirtyKeyCount?: number
  missingKeyCount?: number
}

export type TransactionPrecheckMeasurement = {
  dirtyRange: RuntimeDirtyRange
  plan: TransactionPreCorrectionMeasurementPlan
  measurement: RuntimeMeasurement
}

export function measureTransactionPrecheck<TMessage, TOptimistic>(
  input: {
    pushDiagnostic: PushDiagnostic
    pending: PendingTransaction<TMessage, TOptimistic>
    snapshot: MessageListSnapshot<TMessage, TOptimistic>
    registry: RuntimeDomRegistry
    domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
    dirtyRange: RuntimeDirtyRangeRegistry
  },
): TransactionPrecheckMeasurement {
  const { dirtyRange, domInteractions, pending, pushDiagnostic, registry, snapshot } = input
  const resolvedDirtyRange = dirtyRange.resolve(snapshot)
  const plan = resolveTransactionPreCorrectionMeasurementPlan({
    anchor: pending.anchor,
    segment: pending.segment,
    registry,
    domInteractions,
    dirtyRange: resolvedDirtyRange,
  })
  const measurement = measureRuntimeDom(registry.snapshot(), plan.options)
  emitTransactionPrecheckMeasurementDiagnostics({
    pushDiagnostic,
    token: pending.token,
    segment: pending.segment,
    dirtyRange: resolvedDirtyRange,
    plan,
    measurement,
  })
  return {
    dirtyRange: resolvedDirtyRange,
    plan,
    measurement,
  }
}

export function measureTransactionFinal<TMessage, TOptimistic>(
  input: {
    pushDiagnostic: PushDiagnostic
    pending: PendingTransaction<TMessage, TOptimistic>
    registry: RuntimeDomRegistry
    dirtyRange: RuntimeDirtyRange
  },
): RuntimeMeasurement {
  const { dirtyRange, pending, pushDiagnostic, registry } = input
  const measurement = measureRuntimeDom(registry.snapshot())
  emitTransactionFinalMeasurementDiagnostics({
    pushDiagnostic,
    token: pending.token,
    segment: pending.segment,
    dirtyRange,
    measurement,
  })
  return measurement
}

export function emitMeasurementDiagnostics(
  pushDiagnostic: PushDiagnostic,
  measurement: RuntimeMeasurement,
  source: RuntimeMeasurementSource,
  dirtyRange?: RuntimeDirtyRange,
  context: RuntimeMeasurementDiagnosticContext = {},
): void {
  pushDiagnostic('measurement.rectRead.count', 'debug', {
    ...context,
    source,
    rectReadCount: measurement.rectReadCount,
    rowCount: measurement.visibleRows.length,
    requestedRowCount: measurement.requestedRowCount,
    fallbackFullMeasure: measurement.fallbackFullMeasure,
  })
  pushDiagnostic('measurement.rectRead.rows', 'debug', {
    ...context,
    source,
    rectReadRows: measurement.rectReadRows,
    dirtyKeyCount: dirtyRange?.keys.size ?? 0,
  })
}

export function emitTransactionPrecheckMeasurementDiagnostics<TMessage, TOptimistic>(
  input: {
    pushDiagnostic: PushDiagnostic
    token: ProjectionCommitToken
    segment: LoadedSegment<TMessage, TOptimistic>
    dirtyRange: RuntimeDirtyRange
    plan: TransactionPreCorrectionMeasurementPlan
    measurement: RuntimeMeasurement
  },
): void {
  const { dirtyRange, measurement, plan, pushDiagnostic, segment, token } = input

  emitMeasurementDiagnostics(
    pushDiagnostic,
    measurement,
    'transaction-precheck',
    dirtyRange,
    {
      ...token,
      modifier: segment.modifier.type,
      transactionPhase: 'precheck',
      measurementPlan: plan.mode,
      fullMeasureReason: plan.fullMeasureReason,
      anchorSource: plan.anchorSource,
      dirtyReason: dirtyRange.reason,
      dirtyKeyCount: dirtyRange.keys.size,
      missingKeyCount: dirtyRange.missingKeys.length,
    },
  )
  if (!measurement.fallbackFullMeasure) return
  pushDiagnostic('measurement.transaction.fullMeasure', 'info', {
    ...token,
    modifier: segment.modifier.type,
    transactionPhase: 'precheck',
    fullMeasureReason: plan.fullMeasureReason,
    rectReadCount: measurement.rectReadCount,
    rowCount: measurement.visibleRows.length,
    requestedRowCount: measurement.requestedRowCount,
    dirtyReason: dirtyRange.reason,
    dirtyKeyCount: dirtyRange.keys.size,
    missingKeyCount: dirtyRange.missingKeys.length,
  })
}

export function emitTransactionFinalMeasurementDiagnostics<TMessage, TOptimistic>(
  input: {
    pushDiagnostic: PushDiagnostic
    token: ProjectionCommitToken
    segment: LoadedSegment<TMessage, TOptimistic>
    dirtyRange: RuntimeDirtyRange
    measurement: RuntimeMeasurement
  },
): void {
  const { dirtyRange, measurement, pushDiagnostic, segment, token } = input

  emitMeasurementDiagnostics(
    pushDiagnostic,
    measurement,
    'transaction-final',
    dirtyRange,
    {
      ...token,
      modifier: segment.modifier.type,
      transactionPhase: 'final',
      measurementPlan: 'authoritative-full',
      fullMeasureReason: 'transaction-final',
      dirtyReason: dirtyRange.reason,
      dirtyKeyCount: dirtyRange.keys.size,
      missingKeyCount: dirtyRange.missingKeys.length,
    },
  )
}

export function emitSettledTransactionMeasurementDiagnostics<TMessage, TOptimistic>(
  input: {
    pushDiagnostic: PushDiagnostic
    pending: PendingTransaction<TMessage, TOptimistic>
    precheck: TransactionPrecheckMeasurement
    finalMeasurement: RuntimeMeasurement
    latencyMs: number
  },
): void {
  const {
    finalMeasurement,
    latencyMs,
    pending,
    precheck,
    pushDiagnostic,
  } = input
  const { dirtyRange, measurement: precheckMeasurement, plan: precheckPlan } = precheck
  const { segment, token } = pending

  pushDiagnostic('transaction.settle', 'info', { ...token, latencyMs })
  pushDiagnostic('measurement.transaction.latencyMs', 'debug', {
    ...token,
    latencyMs,
  })
  pushDiagnostic('measurement.transaction.summary', 'info', {
    ...token,
    modifier: segment.modifier.type,
    latencyMs,
    dirtyReason: dirtyRange.reason,
    dirtyKeyCount: dirtyRange.keys.size,
    missingKeyCount: dirtyRange.missingKeys.length,
    totalRectReadCount: precheckMeasurement.rectReadCount + finalMeasurement.rectReadCount,
    precheck: {
      measurementPlan: precheckPlan.mode,
      fullMeasureReason: precheckPlan.fullMeasureReason,
      anchorSource: precheckPlan.anchorSource,
      rectReadCount: precheckMeasurement.rectReadCount,
      rowCount: precheckMeasurement.visibleRows.length,
      requestedRowCount: precheckMeasurement.requestedRowCount,
      fallbackFullMeasure: precheckMeasurement.fallbackFullMeasure,
    },
    final: {
      measurementPlan: 'authoritative-full',
      fullMeasureReason: 'transaction-final',
      rectReadCount: finalMeasurement.rectReadCount,
      rowCount: finalMeasurement.visibleRows.length,
      requestedRowCount: finalMeasurement.requestedRowCount,
      fallbackFullMeasure: finalMeasurement.fallbackFullMeasure,
    },
  })
}
