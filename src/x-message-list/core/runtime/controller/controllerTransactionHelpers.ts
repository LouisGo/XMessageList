import { resolveRemappedAnchorKey } from '../shared/snapshotIdentity'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { DestinationIntent } from '../state/interactionTypes'
import type { VisualAnchor } from '../dom/measurement'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot, ProjectionCommitToken } from '../contracts/snapshot'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import type { TransactionScrollResolution } from '../transactions/transactionSettlement'
import type { ProjectionTransactionPolicy } from './transactionQueue'

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

export function resolveProjectionTransactionPolicy<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  activeFollowBottom: boolean,
): ProjectionTransactionPolicy {
  switch (segment.modifier.type) {
    case 'reset-around':
    case 'bootstrap':
      return transactionPolicy('destination', 100, false, false)
    case 'reset-latest':
      return transactionPolicy('latest-follow', 90, false, false)
    case 'extend-before':
    case 'extend-after':
      return transactionPolicy('edge', 70, false, true)
    case 'append':
      if (
        segment.modifier.follow === 'follow' ||
        snapshot.pendingIntent === 'follow-bottom' ||
        activeFollowBottom
      ) {
        return transactionPolicy('latest-follow', 90, false, false)
      }
      return transactionPolicy('live-append', 50, true, true)
    case 'identity-remap':
      return transactionPolicy('passive', 35, false, true)
    case 'patch':
      return transactionPolicy('passive', 30, true, true)
    case 'trim-before':
    case 'trim-after':
      return transactionPolicy('maintenance', 10, true, true)
  }
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

function transactionPolicy(
  lane: ProjectionTransactionPolicy['lane'],
  priority: number,
  coalescible: boolean,
  queueDuringMotion: boolean,
): ProjectionTransactionPolicy {
  return { lane, priority, coalescible, queueDuringMotion }
}
