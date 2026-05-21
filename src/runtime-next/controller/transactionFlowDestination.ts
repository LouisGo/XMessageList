import type { RuntimeTransaction } from '../transactions/types'
import type { RuntimeTransactionFlowContext } from './transactionFlow.types'

export function emitDestinationSettled<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  transaction: RuntimeTransaction<TMessage, TOptimistic>,
): void {
  if (transaction.kind !== 'jump' || transaction.intent.kind !== 'jump') {
    return
  }

  const data = ctx.data.requireSnapshot()
  const eventTarget =
    transaction.intent.requestedTarget ?? transaction.intent.target
  const resolvedTarget = data.anchor &&
    data.anchor.messageId !== eventTarget.messageId
    ? data.anchor
    : undefined

  ctx.emitEvent({
    type: 'destinationSettled',
    feedId: data.feedId,
    generation: data.generation,
    intent: 'jump',
    target: eventTarget,
    resolution: data.anchorStatus === 'deleted'
      ? 'fallback-deleted'
      : 'target',
    resolvedTarget: transaction.intent.requestedTarget
      ? transaction.intent.target
      : resolvedTarget,
  })
}
