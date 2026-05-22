import type { MessageDataSnapshot } from '../../types'
import type { TransactionRunner } from '../../transactions/transactionRunner'
import type { ViewportTransactionController } from '../../transactions/viewportTransactionController'

type ReservedDataTransactionKind =
  | 'removeFromStart'
  | 'itemLocation'
  | 'identityRebind'
  | 'anchorRisk'

export function enqueueReservedDataTransaction<TMessage, TOptimistic>(
  transactions: TransactionRunner,
  controller: ViewportTransactionController<TMessage, TOptimistic>,
  kind: ReservedDataTransactionKind,
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): void {
  switch (kind) {
    case 'removeFromStart':
      transactions.enqueue(
        'removeFromStart',
        () => controller.runRemoveFromStartTransaction(snapshot),
        'remove-from-start',
      )
      return
    case 'itemLocation':
      transactions.enqueue(
        'itemLocation',
        () => controller.runItemLocationTransaction(snapshot),
        'item-location',
      )
      return
    case 'identityRebind':
      transactions.enqueue(
        'identityRebind',
        () => controller.runIdentityRebindTransaction(snapshot),
        'identity-rebind',
      )
      return
    case 'anchorRisk':
      transactions.enqueue(
        'anchorRisk',
        () => controller.runAnchorRiskTransaction(snapshot),
        'anchor-risk',
      )
  }
}
