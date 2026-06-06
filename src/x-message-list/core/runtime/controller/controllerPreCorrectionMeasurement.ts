import type { LoadedSegment } from '../contracts/segment'
import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeDirtyRange } from '../dom/dirtyRange'
import type { RuntimeMeasurementOptions, VisualAnchor } from '../dom/measurement'
import { resolveRemappedAnchorKey } from '../shared/snapshotIdentity'

export type TransactionPreCorrectionMeasurementPlan = {
  options: RuntimeMeasurementOptions
  mode: 'sampled-keys' | 'full-measure'
  fullMeasureReason?: 'no-anchor' | 'reset-around' | 'unknown-dirty-range' | 'anchor-missing-after-remap' | 'missing-scroll-sample'
  anchorSource?: 'captured' | 'segment-anchor'
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
  const measurementAnchor = resolveMeasurementAnchor(input)

  if (!measurementAnchor) {
    return fullMeasure(input.anchor ? 'anchor-missing-after-remap' : 'no-anchor')
  }

  if (input.segment.modifier.type === 'reset-around') {
    return fullMeasure('reset-around')
  }

  if (isUnknownDirtyRange(input.dirtyRange)) {
    return fullMeasure('unknown-dirty-range')
  }

  const sampleKeys = input.domInteractions.getScrollSampleKeys()
  if (!sampleKeys || sampleKeys.length === 0) {
    return fullMeasure('missing-scroll-sample')
  }

  return {
    options: {
      rowKeys: [...new Set([measurementAnchor.key, ...sampleKeys])],
    },
    mode: 'sampled-keys',
    anchorSource: measurementAnchor.source,
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

function resolveMeasurementAnchor<TMessage, TOptimistic>(
  input: {
    anchor: VisualAnchor | null
    segment: LoadedSegment<TMessage, TOptimistic>
    registry: RuntimeDomRegistry
  },
): { key: MessageRuntimeItemKey; source: NonNullable<TransactionPreCorrectionMeasurementPlan['anchorSource']> } | null {
  if (input.anchor) {
    const capturedAnchorKey = resolveRemappedAnchorKey(input.anchor.key, input.segment)
    if (input.registry.getRow(capturedAnchorKey)) {
      return { key: capturedAnchorKey, source: 'captured' }
    }

    if (input.segment.modifier.type !== 'reset-latest') {
      return null
    }
  }

  if (input.segment.modifier.type !== 'reset-latest' || !input.segment.anchor) {
    return null
  }

  const segmentAnchorKey = findSegmentAnchorKey(input.segment)
  return segmentAnchorKey && input.registry.getRow(segmentAnchorKey)
    ? { key: segmentAnchorKey, source: 'segment-anchor' }
    : null
}

function findSegmentAnchorKey<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
): MessageRuntimeItemKey | null {
  const anchor = segment.anchor
  if (!anchor) {
    return null
  }

  const item = segment.items.find((candidate) => {
    const identity = candidate.identity
    return identity &&
      identity.sessionId === anchor.sessionId &&
      (
        identity.stableId === anchor.stableId ||
        Boolean(identity.serverId && identity.serverId === anchor.serverId) ||
        Boolean(identity.localId && identity.localId === anchor.localId)
      )
  })

  return item?.key ?? null
}
