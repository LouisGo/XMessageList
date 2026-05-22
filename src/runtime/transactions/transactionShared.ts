import type { AnchorState, MessageIdentityAnchor } from '../types'
import type { MeasurableRow, RestoreTarget } from '../core/state/runtimeTypes'
import { areRuntimeItemKeysEqual } from '../shared/utils'

export function getJumpResolution(
  originalTarget: MessageIdentityAnchor | undefined,
  resolvedTarget: MessageIdentityAnchor,
): 'target' | 'fallback-deleted' {
  if (!originalTarget || originalTarget.messageId === resolvedTarget.messageId) {
    return 'target'
  }

  return 'fallback-deleted'
}

export function createSettledRestoreAnchor(
  target: RestoreTarget,
  resolved: MeasurableRow,
): AnchorState {
  return {
    key: resolved.key,
    offsetWithinMessage: areRuntimeItemKeysEqual(resolved.key, target.key)
      ? target.offsetWithinMessage
      : 0,
  }
}
