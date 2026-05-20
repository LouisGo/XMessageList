import type { MessageIdentityAnchor, MessageRuntimeItemKey } from './types'

export function isMessageRuntimeItemKeyEqual(
  left: MessageRuntimeItemKey,
  right: MessageRuntimeItemKey,
): boolean {
  if (left.kind === 'committed' && right.kind === 'committed') {
    return left.messageId === right.messageId
  }

  if (left.kind === 'optimistic' && right.kind === 'optimistic') {
    return left.clientMessageId === right.clientMessageId
  }

  return false
}

export function stringifyMessageRuntimeItemKey(
  key: MessageRuntimeItemKey,
): string {
  return key.kind === 'committed'
    ? `committed:${key.messageId}`
    : `optimistic:${key.clientMessageId}`
}

export function anchorToCommittedItemKey(
  anchor: MessageIdentityAnchor,
): MessageRuntimeItemKey {
  return {
    kind: 'committed',
    messageId: anchor.messageId,
  }
}
