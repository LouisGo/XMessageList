import {
  cloneAnchorState,
  isAnchorState,
  type DestinationMotionForcedStart,
} from './runtimeTypes'
import type {
  AnchorState,
  MessageDataSnapshot,
  MessageIdentityAnchor,
} from '../types'
import type { RenderWindowEngine } from '../window/renderWindowEngine'

export function hasCommittedMessage<TMessage, TOptimistic>(
  renderWindow: RenderWindowEngine,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  messageId: string,
): boolean {
  return renderWindow.findCommittedMessageIndex(data.items, messageId) >= 0
}

export function resolvePendingJumpTarget<TMessage, TOptimistic>(
  renderWindow: RenderWindowEngine,
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  target: MessageIdentityAnchor,
): MessageIdentityAnchor | null {
  if (hasCommittedMessage(renderWindow, snapshot, target.messageId)) {
    return target
  }

  if (
    snapshot.anchorStatus === 'deleted' &&
    snapshot.anchor &&
    hasCommittedMessage(renderWindow, snapshot, snapshot.anchor.messageId)
  ) {
    return { ...snapshot.anchor }
  }

  return null
}

export function getIdentityTarget(
  target: AnchorState | MessageIdentityAnchor,
): MessageIdentityAnchor | null {
  if (!isAnchorState(target)) {
    return { ...target }
  }

  if (target.key.kind !== 'committed') {
    return null
  }

  return { messageId: target.key.messageId }
}

export function getJumpForcedStart(
  origin: MessageIdentityAnchor | undefined,
  target: MessageIdentityAnchor,
): DestinationMotionForcedStart | undefined {
  if (
    !origin ||
    !Number.isFinite(origin.position) ||
    !Number.isFinite(target.position)
  ) {
    return undefined
  }

  const originPosition = origin.position as number
  const targetPosition = target.position as number

  if (targetPosition < originPosition) {
    return 'afterTarget'
  }

  if (targetPosition > originPosition) {
    return 'beforeTarget'
  }

  return undefined
}

export function cloneDestinationCommandTarget(
  target: AnchorState | MessageIdentityAnchor,
): AnchorState | MessageIdentityAnchor {
  return isAnchorState(target) ? cloneAnchorState(target) : { ...target }
}
