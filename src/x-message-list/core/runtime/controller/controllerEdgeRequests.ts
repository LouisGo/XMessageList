import type { RuntimeEdge } from '../interactions/interactionState'
import type { RuntimeInteractionState } from '../interactions/interactionState'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { InteractionUpdate } from '../state/interactionTypes'

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
