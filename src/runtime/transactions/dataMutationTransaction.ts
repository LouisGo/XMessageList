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

  const stillCurrent = isSameDataRevision(current, snapshot)

  if (!stillCurrent) {
    emitStaleDataSnapshotDiagnostic(deps, snapshot, current)
  }

  return stillCurrent
}

export function shouldBootstrapCurrentDataForReset<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): boolean {
  const current = deps.getDataSnapshot()

  if (!current) {
    return false
  }

  if (isSameDataRevision(current, snapshot)) {
    return true
  }

  if (!isSameDataGeneration(current, snapshot)) {
    emitStaleDataSnapshotDiagnostic(deps, snapshot, current)
    return false
  }

  deps.emitDiagnostic({
    channel: 'transaction',
    severity: 'debug',
    name: 'transaction.resetSnapshotSuperseded',
    details: () => ({
      expected: toDataIdentity(snapshot),
      current: toDataIdentity(current),
    }),
  })

  return true
}

function isSameDataRevision<TMessage, TOptimistic>(
  current: MessageDataSnapshot<TMessage, TOptimistic>,
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): boolean {
  return (
    isSameDataGeneration(current, snapshot) &&
    current.revision === snapshot.revision
  )
}

function isSameDataGeneration<TMessage, TOptimistic>(
  current: MessageDataSnapshot<TMessage, TOptimistic>,
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): boolean {
  return (
    current.feedId === snapshot.feedId &&
    current.generation === snapshot.generation
  )
}

function emitStaleDataSnapshotDiagnostic<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  expected: MessageDataSnapshot<TMessage, TOptimistic>,
  current: MessageDataSnapshot<TMessage, TOptimistic>,
): void {
  deps.emitDiagnostic({
    channel: 'transaction',
    severity: 'debug',
    name: 'transaction.skipStaleDataSnapshot',
    details: () => ({
      expected: toDataIdentity(expected),
      current: toDataIdentity(current),
    }),
  })
}

function toDataIdentity<TMessage, TOptimistic>(
  snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
): {
  feedId: string
  generation: number
  revision: number
} {
  return {
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    revision: snapshot.revision,
  }
}
