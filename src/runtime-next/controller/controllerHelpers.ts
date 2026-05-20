import type { MessageDataSnapshot } from '../data/types'
import type {
  AnchorState,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../identity/types'
import { anchorToCommittedItemKey, isMessageRuntimeItemKeyEqual } from '../identity/itemKey'
import type {
  BootstrapState,
  MessageDataItem,
  RenderWindow,
  ViewportEdgeState,
  ViewportPhase,
} from '../projection/types'
import type { RuntimeNextViewportEvent } from '../events/types'
import type { RuntimeTransaction } from '../transactions/types'

export function findItemByKey<TMessage, TOptimistic>(
  items: readonly MessageDataItem<TMessage, TOptimistic>[],
  key: MessageRuntimeItemKey,
): MessageDataItem<TMessage, TOptimistic> | null {
  return items.find((item) => isMessageRuntimeItemKeyEqual(item.key, key)) ?? null
}

export function selectItemsByRenderWindow<TMessage, TOptimistic>(
  items: readonly MessageDataItem<TMessage, TOptimistic>[],
  renderWindow: RenderWindow,
): readonly MessageDataItem<TMessage, TOptimistic>[] {
  return renderWindow.itemKeys
    .map((key) => findItemByKey(items, key))
    .filter((item): item is MessageDataItem<TMessage, TOptimistic> => item !== null)
}

export function hasCommittedTarget<TMessage, TOptimistic>(
  items: readonly MessageDataItem<TMessage, TOptimistic>[],
  target: MessageIdentityAnchor,
): boolean {
  return items.some(
    (item) => item.key.kind === 'committed' && item.key.messageId === target.messageId,
  )
}

export function isTargetAvailable<TMessage, TOptimistic>(
  items: readonly MessageDataItem<TMessage, TOptimistic>[],
  target: MessageIdentityAnchor | AnchorState,
): boolean {
  return 'key' in target
    ? items.some((item) => isMessageRuntimeItemKeyEqual(item.key, target.key))
    : hasCommittedTarget(items, target)
}

export function targetToIdentityAnchor(
  target: MessageIdentityAnchor | AnchorState,
): MessageIdentityAnchor {
  if ('messageId' in target) {
    return target
  }
  if (target.key.kind === 'committed') {
    return {
      messageId: target.key.messageId,
      position: target.offsetWithinMessage,
    }
  }

  return {
    messageId: target.key.clientMessageId,
    position: target.offsetWithinMessage,
  }
}

export function anchorFromTarget(
  target: MessageIdentityAnchor | AnchorState | undefined,
): AnchorState | null {
  if (target === undefined) {
    return null
  }

  return 'key' in target
    ? target
    : {
        key: anchorToCommittedItemKey(target),
        offsetWithinMessage: target.position ?? 0,
      }
}

export function createNeedMessagesAroundEvent(input: {
  readonly feedId: string
  readonly generation: number
  readonly reason: 'jump' | 'restore'
  readonly target: MessageIdentityAnchor | AnchorState
}): RuntimeNextViewportEvent {
  return {
    type: 'needMessagesAround',
    feedId: input.feedId,
    generation: input.generation,
    reason: input.reason,
    target: targetToIdentityAnchor(input.target),
  }
}

export function createNeedLatestEvent(input: {
  readonly feedId: string
  readonly generation: number
}): RuntimeNextViewportEvent {
  return {
    type: 'needLatestMessages',
    feedId: input.feedId,
    generation: input.generation,
    reason: 'bottom-follow',
  }
}

export function edgeStateFromSnapshot(
  snapshot: MessageDataSnapshot,
): ViewportEdgeState {
  return {
    before: snapshot.hasMoreBefore ? 'loading' : 'idle',
    after: snapshot.hasMoreAfter ? 'loading' : 'idle',
  }
}

export function phaseForTransaction(
  kind: RuntimeTransaction['kind'],
): ViewportPhase {
  if (kind === 'segmentShift') {
    return 'SEGMENT_SHIFTING'
  }
  if (kind === 'jump' || kind === 'restore') {
    return 'DESTINATION_PENDING'
  }
  if (kind === 'projectionRefresh') {
    return 'IDLE'
  }

  return 'RECOVERING'
}

export function bootstrapStateForPublish(
  kind: RuntimeTransaction['kind'],
  current: BootstrapState,
): BootstrapState {
  return kind === 'bootstrap' ? 'MOUNTING' : current
}

export function bootstrapStateAfterCommit(
  kind: RuntimeTransaction['kind'],
  snapshot: MessageDataSnapshot,
  current: BootstrapState,
): BootstrapState {
  if (kind !== 'bootstrap') {
    return current
  }

  return snapshot.items.length === 0 ? 'READY_EMPTY' : 'READY'
}
