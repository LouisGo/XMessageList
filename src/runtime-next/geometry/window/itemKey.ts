import type { MessageRuntimeItemKey } from '../../identity/types'

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
