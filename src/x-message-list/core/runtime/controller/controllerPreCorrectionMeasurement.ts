import type { LoadedSegment } from '../contracts/segment'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeDirtyRange } from '../dom/dirtyRange'
import type { RuntimeMeasurementOptions, VisualAnchor } from '../dom/measurement'
import { resolveRemappedAnchorKey } from '../shared/snapshotIdentity'

export type TransactionPreCorrectionMeasurementPlan = {
  options: RuntimeMeasurementOptions
  mode: 'sampled-keys' | 'full-measure'
  fullMeasureReason?: 'no-anchor' | 'reset-around' | 'unknown-dirty-range' | 'anchor-missing-after-remap' | 'missing-scroll-sample'
}

export function resolveTransactionPreCorrectionMeasurementPlan<TMessage, TOptimistic>(
  input: {
    anchor: VisualAnchor | null
    segment: LoadedSegment<TMessage, TOptimistic>
    registry: RuntimeDomRegistry
    domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
    dirtyRange: RuntimeDirtyRange
  },
): TransactionPreCorrectionMeasurementPlan {
  if (!input.anchor) {
    return fullMeasure('no-anchor')
  }

  if (input.segment.modifier.type === 'reset-around') {
    return fullMeasure('reset-around')
  }

  if (isUnknownDirtyRange(input.dirtyRange)) {
    return fullMeasure('unknown-dirty-range')
  }

  const anchorKey = resolveRemappedAnchorKey(input.anchor.key, input.segment)
  if (!input.registry.getRow(anchorKey)) {
    return fullMeasure('anchor-missing-after-remap')
  }

  const sampleKeys = input.domInteractions.getScrollSampleKeys()
  if (!sampleKeys || sampleKeys.length === 0) {
    return fullMeasure('missing-scroll-sample')
  }

  return {
    options: {
      rowKeys: [...new Set([anchorKey, ...sampleKeys])],
    },
    mode: 'sampled-keys',
  }
}

function isUnknownDirtyRange(dirtyRange: RuntimeDirtyRange): boolean {
  return dirtyRange.reason === 'unknown' && dirtyRange.fallbackFullMeasure
}

function fullMeasure(
  reason: NonNullable<TransactionPreCorrectionMeasurementPlan['fullMeasureReason']>,
): TransactionPreCorrectionMeasurementPlan {
  return {
    options: {},
    mode: 'full-measure',
    fullMeasureReason: reason,
  }
}
