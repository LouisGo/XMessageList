import type { MessageDataSnapshot } from '../../types'

export function isResetRebuildSnapshot<TMessage, TOptimistic>(
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): boolean {
  return snapshot.change.kind === 'reset'
}

export function isLatestRebuildSnapshot<TMessage, TOptimistic>(
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): boolean {
  return isResetRebuildSnapshot(snapshot) && !snapshot.hasMoreAfter
}

export function isAroundRebuildSnapshot<TMessage, TOptimistic>(
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): boolean {
  return isResetRebuildSnapshot(snapshot)
}
