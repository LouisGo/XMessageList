import type { MessageDataSnapshot } from '../types'
import type { ViewportTransactionDeps } from './viewportTransactionController'

export function shouldRunDataMutationTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): boolean {
  const current = deps.getDataSnapshot()

  if (!current) {
    return false
  }

  const stillCurrent =
    current.feedId === snapshot.feedId &&
    current.generation === snapshot.generation &&
    current.revision === snapshot.revision

  if (!stillCurrent) {
    deps.emitDiagnostic({
      channel: 'transaction',
      severity: 'debug',
      name: 'transaction.skipStaleDataSnapshot',
      details: () => ({
        expected: {
          feedId: snapshot.feedId,
          generation: snapshot.generation,
          revision: snapshot.revision,
        },
        current: {
          feedId: current.feedId,
          generation: current.generation,
          revision: current.revision,
        },
      }),
    })
  }

  return stillCurrent
}
