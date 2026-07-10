import type { RuntimeEdge } from '../interactions/interactionState'
import type { RuntimeInteractionState } from '../interactions/interactionState'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { InteractionUpdate } from '../state/interactionTypes'
import type { ScrollSource } from '../scroll/scrollIntentEngine'

export function createCommandEdgeRequest<TMessage, TOptimistic>(input: {
  interactions: RuntimeInteractionState<TMessage, TOptimistic>
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  edge: RuntimeEdge
  reason: string
}): InteractionUpdate<TMessage, TOptimistic> | null {
  return input.interactions.startCommandEdgeNeed(
    input.snapshot,
    input.edge,
    input.reason,
  )
}

export function createViewportEdgeRequest<TMessage, TOptimistic>(input: {
  interactions: RuntimeInteractionState<TMessage, TOptimistic>
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  edge: RuntimeEdge
  source: ScrollSource
}): InteractionUpdate<TMessage, TOptimistic> | null {
  return input.interactions.startEdgeNeed(
    input.snapshot,
    input.edge,
    input.edge === 'before' ? 'near-before' : 'near-after',
    input.edge === 'before' ? 'edge-before' : 'edge-after',
    { source: input.source },
  )
}
