import { resolveRemappedAnchorKey } from '../shared/snapshotIdentity'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { DestinationIntent } from '../state/interactionTypes'
import type { VisualAnchor } from '../dom/measurement'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import type { TransactionScrollResolution } from '../transactions/transactionSettlement'

export type PendingTransaction<TMessage, TOptimistic> = {
  token: ProjectionCommitToken
  segment: LoadedSegment<TMessage, TOptimistic>
  anchor: VisualAnchor | null
  timeoutHandle: number
  startedAt: number
  anchorRetryCount: number
}

/**
 * 已解析但尚未启动的 motion；queued transaction 优先时用它把 settle 结果安全接力到队列 drain 之后。
 */
export type PendingRuntimeMotion<TMessage, TOptimistic> = {
  settlement: Extract<TransactionScrollResolution, { kind: 'motion' }>
  scrollSource: ScrollSource
  segment: LoadedSegment<TMessage, TOptimistic>
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

  if (
    input.segment.modifier.type === 'append' &&
    input.segment.modifier.follow === 'follow'
  ) {
    return 'followBottom'
  }

  if (input.segment.modifier.type === 'reset-latest' ||
    input.segment.modifier.type === 'reset-around' ||
    input.segment.modifier.type === 'bootstrap') {
    return 'programmatic'
  }

  return 'recovery'
}

export function shouldPreservePendingIntentForSegment<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  segment: LoadedSegment<TMessage, TOptimistic>,
): boolean {
  return (
    snapshot.pendingIntent === 'follow-bottom' &&
    segment.modifier.type === 'reset-latest'
  ) || (
    snapshot.pendingIntent === 'destination' &&
    segment.modifier.type === 'reset-around'
  )
}
