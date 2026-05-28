import { withNextProjectionRevision } from './controllerHelpers'
import type { RuntimeInteractionState, RuntimeEdge, InteractionUpdate } from './interactionState'
import type { RuntimeMeasurement } from './measurement'
import type { ScrollSource } from './scrollIntentEngine'
import type { MessageListSnapshot } from './snapshot'

type PostCommitInteractionInput<TMessage, TOptimistic> = {
  interactions: RuntimeInteractionState<TMessage, TOptimistic>
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  measurement: RuntimeMeasurement
  directScrollEdgeIntent: RuntimeEdge | null
  scrollSource: ScrollSource | null
  allowDirectScrollEdge: boolean
}

export function createPostCommitInteractionUpdates<TMessage, TOptimistic>(
  input: PostCommitInteractionInput<TMessage, TOptimistic>,
): Array<InteractionUpdate<TMessage, TOptimistic>> {
  const updates: Array<InteractionUpdate<TMessage, TOptimistic>> = []
  let snapshot = input.snapshot
  const underflowUpdate = input.interactions.evaluateUnderflow({
    snapshot,
    scrollHeight: input.measurement.scrollHeight,
    clientHeight: input.measurement.clientHeight,
  })

  if (underflowUpdate) {
    updates.push(underflowUpdate)
    snapshot = withNextProjectionRevision(underflowUpdate.snapshot)
  }

  if (input.allowDirectScrollEdge && input.directScrollEdgeIntent) {
    const edge = input.directScrollEdgeIntent
    const edgeUpdate = input.interactions.startEdgeNeed(
      snapshot,
      edge,
      edge === 'before' ? 'near-before' : 'near-after',
      edge === 'before' ? 'edge-before' : 'edge-after',
      { source: input.scrollSource ?? 'user' },
    )
    if (edgeUpdate) {
      updates.push(edgeUpdate)
    }
  }

  return updates
}
