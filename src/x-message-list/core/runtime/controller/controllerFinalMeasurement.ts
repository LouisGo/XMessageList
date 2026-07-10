import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { LoadedSegment } from '../contracts/segment'
import type { RuntimeDirtyRange } from '../dom/dirtyRange'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeMeasurementOptions, VisualAnchor } from '../dom/measurement'
import { resolveTransactionAnchorCandidateKeys } from '../shared/snapshotIdentity'

const ANCHOR_NEIGHBOR_RADIUS = 16

export type TransactionFinalMeasurementPlan = {
  options: RuntimeMeasurementOptions
  mode: 'bounded-authoritative' | 'authoritative-full'
  fullMeasureReason?:
    | 'structural-reset'
    | 'unknown-dirty-range'
    | 'anchor-unavailable'
}

/**
 * Final measurement still reads authoritative container metrics, but ordinary
 * mutations only read rows that can affect correction, visibility, or cache
 * freshness. Structural resets and unprovable anchor/dirty states stay full.
 */
export function resolveTransactionFinalMeasurementPlan<TMessage, TOptimistic>(input: {
  anchor: VisualAnchor | null
  segment: LoadedSegment<TMessage, TOptimistic>
  dirtyRange: RuntimeDirtyRange
  registry: RuntimeDomRegistry
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
}): TransactionFinalMeasurementPlan {
  if (isStructuralReset(input.segment)) return fullMeasure('structural-reset')
  if (input.dirtyRange.fallbackFullMeasure) return fullMeasure('unknown-dirty-range')
  if (input.segment.items.length === 0) {
    return { options: { rowKeys: [] }, mode: 'bounded-authoritative' }
  }

  const anchorKey = resolveAnchorKey(input)
  if (!anchorKey) return fullMeasure('anchor-unavailable')
  const keys = new Set<MessageRuntimeItemKey>()
  addRegisteredKeys(keys, input.domInteractions.getScrollSampleKeys(), input.registry)
  addRegisteredKeys(keys, input.dirtyRange.keys, input.registry)
  addAnchorNeighborhood(keys, anchorKey, input.segment, input.registry)
  return {
    options: { rowKeys: [...keys] },
    mode: 'bounded-authoritative',
  }
}

function resolveAnchorKey<TMessage, TOptimistic>(input: {
  anchor: VisualAnchor | null
  segment: LoadedSegment<TMessage, TOptimistic>
  registry: RuntimeDomRegistry
}): MessageRuntimeItemKey | null {
  if (!input.anchor) return null
  return resolveTransactionAnchorCandidateKeys(input.anchor.key, input.segment)
    .find((key) => input.registry.getRow(key)) ?? null
}

function addAnchorNeighborhood<TMessage, TOptimistic>(
  keys: Set<MessageRuntimeItemKey>,
  anchorKey: MessageRuntimeItemKey,
  segment: LoadedSegment<TMessage, TOptimistic>,
  registry: RuntimeDomRegistry,
): void {
  const anchorIndex = segment.items.findIndex((item) => item.key === anchorKey)
  if (anchorIndex < 0) return
  const start = Math.max(0, anchorIndex - ANCHOR_NEIGHBOR_RADIUS)
  const end = Math.min(segment.items.length, anchorIndex + ANCHOR_NEIGHBOR_RADIUS + 1)
  addRegisteredKeys(keys, segment.items.slice(start, end).map((item) => item.key), registry)
}

function addRegisteredKeys(
  target: Set<MessageRuntimeItemKey>,
  keys: Iterable<MessageRuntimeItemKey> | undefined,
  registry: RuntimeDomRegistry,
): void {
  for (const key of keys ?? []) if (registry.getRow(key)) target.add(key)
}

function isStructuralReset<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
): boolean {
  return segment.modifier.type === 'bootstrap' ||
    segment.modifier.type === 'reset-around' ||
    segment.modifier.type === 'reset-latest'
}

function fullMeasure(
  reason: NonNullable<TransactionFinalMeasurementPlan['fullMeasureReason']>,
): TransactionFinalMeasurementPlan {
  return { options: {}, mode: 'authoritative-full', fullMeasureReason: reason }
}
