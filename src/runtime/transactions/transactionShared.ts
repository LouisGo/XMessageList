import type { MessageIdentityAnchor } from '../types'

export function getJumpResolution(
  originalTarget: MessageIdentityAnchor | undefined,
  resolvedTarget: MessageIdentityAnchor,
): 'target' | 'fallback-deleted' {
  if (!originalTarget || originalTarget.messageId === resolvedTarget.messageId) {
    return 'target'
  }

  return 'fallback-deleted'
}
