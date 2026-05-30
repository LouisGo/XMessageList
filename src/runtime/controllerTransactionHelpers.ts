import { resolveRemappedAnchorKey } from './controllerHelpers'
import type { RuntimeDomRegistry } from './domRegistry'
import type { DestinationIntent } from './interactionTypes'
import type { VisualAnchor } from './measurement'
import type { LoadedSegment } from './segment'
import type { MessageListSnapshot, ProjectionCommitToken } from './snapshot'
import type { TransactionState } from './runtimeStateAxes'
import type { ScrollSource } from './scrollIntentEngine'

export type PendingTransaction<TMessage, TOptimistic> = {
  token: ProjectionCommitToken
  segment: LoadedSegment<TMessage, TOptimistic>
  anchor: VisualAnchor | null
  timeoutHandle: number
  startedAt: number
  anchorRetryCount: number
}

export function shouldWaitForAnchorRef<TMessage, TOptimistic>(
  pending: PendingTransaction<TMessage, TOptimistic>,
  registry: RuntimeDomRegistry,
): boolean {
  if (!pending.anchor || pending.anchorRetryCount > 0) {
    return false
  }

  const key = resolveRemappedAnchorKey(pending.anchor.key, pending.segment)
  return pending.segment.items.some((item) => item.key === key) &&
    !registry.getRow(key)
}

export function resolvePendingAnchorKey<TMessage, TOptimistic>(
  pending: PendingTransaction<TMessage, TOptimistic>,
): string {
  return resolveRemappedAnchorKey(pending.anchor?.key ?? '', pending.segment)
}

export function resolveTransactionStateForPhase(
  phase: MessageListSnapshot['viewportPhase'],
): TransactionState {
  if (phase === 'PROJECTING' || phase === 'MOTION') {
    return 'active'
  }

  if (phase === 'MEASURING') {
    return 'measuring'
  }

  if (phase === 'CORRECTING') {
    return 'correcting'
  }

  return 'idle'
}

export function resolveTransactionScrollSource<TMessage, TOptimistic>(
  input: {
    snapshot: MessageListSnapshot<TMessage, TOptimistic>
    segment: LoadedSegment<TMessage, TOptimistic>
    destination: DestinationIntent | null
  },
): ScrollSource {
  if (input.snapshot.pendingIntent === 'underflow-fill') {
    return 'underflowFill'
  }

  if (
    input.snapshot.pendingIntent === 'follow-bottom' &&
    input.segment.modifier.type === 'reset-latest'
  ) {
    return 'followBottom'
  }

  if (
    input.destination &&
    input.segment.modifier.type === 'reset-around'
  ) {
    return input.destination.reason === 'jump' ? 'jump' : 'programmatic'
  }

  if (input.segment.modifier.type === 'reset-latest' ||
    input.segment.modifier.type === 'reset-around' ||
    input.segment.modifier.type === 'bootstrap') {
    return 'programmatic'
  }

  return 'recovery'
}
