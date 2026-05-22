import type {
  ActiveFollowBottomIntent,
  PendingDestinationRequest,
  PendingFollowBottom,
} from '../state/runtimeTypes'
import type {
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageViewportRuntimeEvent,
} from '../../types'

type DestinationIntentEventDeps = {
  edge: {
    setAfterEdgeLatched(value: boolean): void
  }
  lifecycle: {
    getCurrent(): { feedId: string; generation: number }
  }
  getDataSnapshot: () => MessageDataSnapshot<unknown, unknown> | null
  emitEvent: (event: MessageViewportRuntimeEvent) => void
}

export function emitPendingFollowBottomNeed<TMessage, TOptimistic>(
  deps: DestinationIntentEventDeps,
  pending: PendingFollowBottom | null,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
): void {
  if (!pending || pending.emittedAfterRevision === data.revision) {
    return
  }

  pending.emittedAfterRevision = data.revision
  deps.edge.setAfterEdgeLatched(true)
  deps.emitEvent({
    type: 'needLatestMessages',
    feedId: data.feedId,
    generation: data.generation,
    reason: 'bottom-follow',
  })
}

export function emitPendingDestinationNeed<TMessage, TOptimistic>(
  deps: DestinationIntentEventDeps,
  pending: PendingDestinationRequest | null,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
): void {
  if (!pending || pending.emittedAfterRevision === data.revision) {
    return
  }

  pending.emittedAfterRevision = data.revision
  deps.emitEvent({
    type: 'needMessagesAround',
    feedId: data.feedId,
    generation: data.generation,
    reason: pending.intent,
    target: { ...pending.target },
  })
}

export function emitDestinationSettledEvent(
  deps: DestinationIntentEventDeps,
  event: {
    intent: 'jump'
    target: MessageIdentityAnchor
    resolution: 'target' | 'fallback-deleted'
    resolvedTarget?: MessageIdentityAnchor
  },
): void {
  const data = deps.getDataSnapshot()
  const token = data
    ? { feedId: data.feedId, generation: data.generation }
    : deps.lifecycle.getCurrent()

  deps.emitEvent({
    type: 'destinationSettled',
    feedId: token.feedId,
    generation: token.generation,
    intent: event.intent,
    target: { ...event.target },
    resolution: event.resolution,
    resolvedTarget: event.resolvedTarget ? { ...event.resolvedTarget } : undefined,
  })
}

export function clearFollowBottomIntentDiagnostic(input: {
  intent: ActiveFollowBottomIntent
  reason: string
}): {
  reason: string
  feedId: string
  generation: number
  lastScrollTop: number
} {
  return {
    reason: input.reason,
    feedId: input.intent.feedId,
    generation: input.intent.generation,
    lastScrollTop: input.intent.lastScrollTop,
  }
}
