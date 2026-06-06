import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { LoadedSegment } from '../contracts/segment'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeDirtyRange } from '../dom/dirtyRange'
import type { VisualAnchor } from '../dom/measurement'
import { resolveRemappedAnchorKey } from '../shared/snapshotIdentity'

export function resolveTransactionPreCorrectionMeasurementOptions<TMessage, TOptimistic>(
  input: {
    anchor: VisualAnchor | null
    segment: LoadedSegment<TMessage, TOptimistic>
    registry: RuntimeDomRegistry
    domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
    dirtyRange: RuntimeDirtyRange
  },
): { rowKeys?: MessageRuntimeItemKey[] } {
  if (
    !input.anchor ||
    input.segment.modifier.type === 'reset-around' ||
    isUnknownDirtyRange(input.dirtyRange)
  ) {
    return {}
  }

  const anchorKey = resolveRemappedAnchorKey(input.anchor.key, input.segment)
  if (!input.registry.getRow(anchorKey)) {
    return {}
  }

  const sampleKeys = input.domInteractions.getScrollSampleKeys()
  if (!sampleKeys || sampleKeys.length === 0) {
    return {}
  }

  return {
    rowKeys: [...new Set([anchorKey, ...sampleKeys])],
  }
}

function isUnknownDirtyRange(dirtyRange: RuntimeDirtyRange): boolean {
  return dirtyRange.reason === 'unknown' && dirtyRange.fallbackFullMeasure
}
