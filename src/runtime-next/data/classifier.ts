import type { MessageDataItem } from '../projection/types'
import type { MessageRuntimeItemKey } from '../identity/types'
import { anchorToCommittedItemKey, isMessageRuntimeItemKeyEqual } from '../identity/itemKey'
import type {
  DataArrivalClassification,
  DataArrivalClassifierInput,
  PendingDataIntent,
} from './classifier.types'

export function classifyDataArrival<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  input: DataArrivalClassifierInput<TMessage, TOptimistic>,
): DataArrivalClassification {
  const pending = input.pendingIntent

  if (input.snapshot.change.viewportModifier === 'reset') {
    return {
      intent: {
        kind: 'reset',
        reason: 'data-reset',
      },
    }
  }

  if (pending !== null) {
    return classifyPendingIntent(input, pending)
  }

  if (input.snapshot.change.viewportModifier === 'auto-scroll-to-bottom') {
    return input.snapshot.hasMoreAfter
      ? {
          intent: {
            kind: 'no-op',
            reason: 'latest-data-still-missing',
          },
        }
      : {
          intent: {
            kind: 'followBottom',
            origin: 'auto-scroll-hint',
          },
        }
  }

  if (input.activeProjection === null) {
    return {
      intent: {
        kind: 'no-op',
        reason: 'no-active-segment',
      },
    }
  }

  if (isActiveProjectionStillAddressable(input)) {
    return {
      intent: {
        kind: 'projectionRefresh',
      },
    }
  }

  return {
    intent: {
      kind: 'segmentRelayout',
      reason: 'coverage-risk',
    },
  }
}

function classifyPendingIntent<TMessage, TOptimistic>(
  input: DataArrivalClassifierInput<TMessage, TOptimistic>,
  pending: PendingDataIntent,
): DataArrivalClassification {
  switch (pending.kind) {
    case 'segmentShift':
      return hasAdjacentShiftData(input, pending.direction)
        ? {
            intent: {
              kind: 'segmentShift',
              direction: pending.direction,
            },
          }
        : {
            intent: {
              kind: 'no-op',
              reason: 'pending-shift-missing-data',
            },
          }
    case 'followBottom':
      return input.snapshot.hasMoreAfter
        ? {
            intent: {
              kind: 'no-op',
              reason: 'latest-data-still-missing',
            },
          }
        : {
            intent: {
              kind: 'followBottom',
              origin: pending.origin,
            },
          }
    case 'jump':
      return hasCommittedTarget(input.snapshot.items, pending.target.messageId)
        ? {
            intent: {
              kind: 'jump',
              target: pending.target,
            },
          }
        : {
            intent: {
              kind: 'no-op',
              reason: 'pending-jump-target-missing',
            },
          }
    case 'restore':
      return isRestoreTargetAvailable(input, pending)
        ? {
            intent: {
              kind: 'restore',
              target: pending.target,
            },
          }
        : {
            intent: {
              kind: 'no-op',
              reason: 'pending-restore-target-missing',
            },
          }
  }
}

function isActiveProjectionStillAddressable<TMessage, TOptimistic>(
  input: DataArrivalClassifierInput<TMessage, TOptimistic>,
): boolean {
  const active = input.activeProjection
  if (active === null) {
    return false
  }

  return [
    ...active.renderWindow.itemKeys,
    active.logicalStartItemKey,
    active.logicalEndItemKey,
  ].every((key) =>
    key === null || hasItemKey(input.snapshot.items, key),
  )
}

function isRestoreTargetAvailable<TMessage, TOptimistic>(
  input: DataArrivalClassifierInput<TMessage, TOptimistic>,
  pending: Extract<PendingDataIntent, { readonly kind: 'restore' }>,
): boolean {
  if ('key' in pending.target) {
    return hasItemKey(input.snapshot.items, pending.target.key)
  }

  return hasItemKey(
    input.snapshot.items,
    anchorToCommittedItemKey(pending.target),
  )
}

function hasAdjacentShiftData<TMessage, TOptimistic>(
  input: DataArrivalClassifierInput<TMessage, TOptimistic>,
  direction: 'before' | 'after',
): boolean {
  const active = input.activeProjection
  if (active === null) {
    return false
  }
  const boundaryKey = direction === 'before'
    ? active.logicalStartItemKey
    : active.logicalEndItemKey
  if (boundaryKey === null) {
    return false
  }
  const boundaryIndex = input.snapshot.items.findIndex((item) =>
    isMessageRuntimeItemKeyEqual(item.key, boundaryKey),
  )
  if (boundaryIndex < 0) {
    return false
  }

  return direction === 'before'
    ? boundaryIndex > 0
    : boundaryIndex < input.snapshot.items.length - 1
}

function hasCommittedTarget(
  items: readonly MessageDataItem<unknown, unknown>[],
  messageId: string,
): boolean {
  return hasItemKey(items, {
    kind: 'committed',
    messageId,
  })
}

function hasItemKey(
  items: readonly MessageDataItem<unknown, unknown>[],
  key: MessageRuntimeItemKey,
): boolean {
  return items.some((item) => isMessageRuntimeItemKeyEqual(item.key, key))
}
