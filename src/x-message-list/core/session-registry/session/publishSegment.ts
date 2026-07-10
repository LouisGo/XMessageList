import type {
  LoadedSegment,
  MessageListRuntime,
} from '../../runtime/index'
import type { LoadedSegmentStore } from '../loaded-segment-store/index'
import {
  resolveAdaptiveTrimBudget,
  resolveTrimProtectKey,
  type SessionDefaults,
} from './helpers'

export function prepareSessionSegmentForPublish<Row>(input: {
  segment: LoadedSegment<Row>
  previous: LoadedSegment<Row>
  runtime: MessageListRuntime<Row>
  loadedSegmentStore: LoadedSegmentStore<Row>
  defaults: SessionDefaults
  rowsPerViewportEstimate: number
}): { segment: LoadedSegment<Row>; topologyChanged: boolean } {
  const originalModifier = input.segment.modifier
  const budget = resolveAdaptiveTrimBudget({
    pageSize: input.defaults.pageSize,
    retention: input.defaults.retention,
    rowsPerViewportEstimate: input.rowsPerViewportEstimate,
  })
  let current = input.segment
  const maxTrimPasses = Math.max(1, current.items.length)

  for (let guard = 0; guard < maxTrimPasses && current.items.length > budget; guard += 1) {
    const previousLength = current.items.length
    const trimmed = input.loadedSegmentStore.trimToBudget(
      budget,
      resolveSegmentProtectKey(current) ??
        resolveTrimProtectKey(input.runtime, input.loadedSegmentStore),
    )
    if (trimmed === current || trimmed.items.length >= previousLength) break
    current = trimmed
  }

  const projected = current.modifier === originalModifier
    ? current
    : { ...current, modifier: originalModifier }
  return {
    segment: projected,
    topologyChanged: hasSegmentTopologyChanged(input.previous, projected),
  }
}

function resolveSegmentProtectKey<Row>(segment: LoadedSegment<Row>): string | undefined {
  if (segment.modifier.type === 'reset-latest') {
    return segment.items.at(-1)?.key
  }
  if (segment.modifier.type !== 'reset-around') return undefined
  const target = segment.modifier.target
  return segment.items.find((item) => item.identity && (
    item.identity.stableId === target.stableId ||
    Boolean(item.identity.serverId && item.identity.serverId === target.serverId) ||
    Boolean(item.identity.localId && item.identity.localId === target.localId)
  ))?.key
}

function hasSegmentTopologyChanged<Row>(
  previous: LoadedSegment<Row>,
  next: LoadedSegment<Row>,
): boolean {
  if (
    previous.context !== next.context ||
    previous.hasMoreBefore !== next.hasMoreBefore ||
    previous.hasMoreAfter !== next.hasMoreAfter ||
    previous.items.length !== next.items.length
  ) {
    return true
  }
  return previous.items.some((item, index) => item.key !== next.items[index]?.key)
}
