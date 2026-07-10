import type { LoadedSegment } from '../contracts/segment'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { RuntimeDirtyRangeRegistry } from '../dom/dirtyRange'
import type { MessageListSnapshot } from '../contracts/snapshot'

type SegmentDirtyHost<TMessage, TOptimistic> = {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  dirtyRange: RuntimeDirtyRangeRegistry
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
}

export function markSegmentDirty<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  host: SegmentDirtyHost<TMessage, TOptimistic>,
): void {
  switch (segment.modifier.type) {
    case 'bootstrap':
    case 'reset-latest':
    case 'reset-around':
      host.dirtyRange.markAllDirty('segment')
      host.domInteractions.markAllRowMetricsDirty('segment')
      break
    case 'trim-before':
    case 'trim-after':
      deleteRemovedMetrics(segment, host)
      if (segment.modifier.type === 'trim-before') {
        host.domInteractions.invalidateRowMetricsFromIndex(segment.items, 0, 'trim-before-shift')
      }
      break
    case 'extend-before':
    case 'extend-after': {
      const keys = changedItemKeys(segment, host.snapshot)
      markKeys(keys, 'segment', host)
      if (segment.modifier.type === 'extend-before') {
        host.domInteractions.invalidateRowMetricsFromIndex(segment.items, 0, 'extend-before-shift')
      }
      break
    }
    case 'patch':
      markKeys(segment.modifier.changedKeys, 'render-version', host)
      invalidateAfterFirstChanged(segment, segment.modifier.changedKeys, 'patch-suffix', host)
      break
    case 'remove':
      for (const key of segment.modifier.removedKeys) {
        host.domInteractions.deleteRowMetric(key)
        host.dirtyRange.deleteKey(key)
      }
      markKeys(segment.modifier.changedKeys, 'render-version', host)
      host.domInteractions.invalidateRowMetricsFromIndex(
        segment.items,
        segment.modifier.firstAffectedIndex,
        'remove-suffix',
      )
      break
    case 'append':
      markKeys(segment.modifier.changedKeys, 'segment', host)
      for (const retired of segment.modifier.retireKeys ?? []) {
        host.domInteractions.deleteRowMetric(retired)
        host.dirtyRange.deleteKey(retired)
      }
      if (segment.modifier.retireKeys?.length) {
        host.domInteractions.invalidateRowMetricsFromIndex(segment.items, 0, 'append-retire-shift')
      }
      break
    case 'identity-remap':
      for (const remap of segment.modifier.remaps) {
        host.dirtyRange.markDirty(remap.nextKey, 'render-version')
        host.domInteractions.remapRowMetric(remap.previousKey, remap.nextKey)
      }
      break
    default:
      host.dirtyRange.markAllDirty('unknown')
      host.domInteractions.markAllRowMetricsDirty('unknown')
  }

  applyTrimEffects(segment, host)
}

function applyTrimEffects<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  host: SegmentDirtyHost<TMessage, TOptimistic>,
): void {
  for (const effect of segment.effects ?? []) {
    if (effect.type !== 'trim-before' && effect.type !== 'trim-after') continue
    deleteRemovedMetrics(segment, host)
    if (effect.type === 'trim-before') {
      host.domInteractions.invalidateRowMetricsFromIndex(
        segment.items,
        0,
        'trim-before-shift',
      )
    }
  }
}

function markKeys<TMessage, TOptimistic>(
  keys: Iterable<string>,
  reason: 'segment' | 'render-version',
  host: SegmentDirtyHost<TMessage, TOptimistic>,
): void {
  host.dirtyRange.markDirtyKeys(keys, reason)
  host.domInteractions.markRowMetricDirtyKeys(keys)
}

function changedItemKeys<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  previous: MessageListSnapshot<TMessage, TOptimistic>,
): string[] {
  const previousByKey = new Map(previous.items.map((item) => [item.key, item]))
  return segment.items
    .filter((item) => previousByKey.get(item.key) !== item)
    .map((item) => item.key)
}

function deleteRemovedMetrics<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  host: SegmentDirtyHost<TMessage, TOptimistic>,
): void {
  const nextKeys = new Set(segment.items.map((item) => item.key))
  for (const item of host.snapshot.items) {
    if (!nextKeys.has(item.key)) host.domInteractions.deleteRowMetric(item.key)
  }
}

function invalidateAfterFirstChanged<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  keys: string[],
  reason: string,
  host: SegmentDirtyHost<TMessage, TOptimistic>,
): void {
  const changed = new Set(keys)
  const index = segment.items.findIndex((item) => changed.has(item.key))
  if (index >= 0 && index + 1 < segment.items.length) {
    host.domInteractions.invalidateRowMetricsFromIndex(segment.items, index + 1, reason)
  }
}
