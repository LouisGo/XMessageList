import type {
  AnchorState,
  MessageIdentityRemap,
  MessageRuntimeItemKey,
  ViewportTransactionKind,
} from '../types'
import {
  areRuntimeItemKeysEqual,
  serializeRuntimeItemKey,
} from '../shared/utils'
import type { ViewportTransactionDeps } from './viewportTransactionController'
import { runAnchorRestoreTransaction } from './destinationTransactions'
import {
  correctPreservedAnchorAfterCommit,
  getFallbackRenderWindow,
  runAnchorlessReservedRefresh,
  settleReservedTransaction,
} from './reservedModifierShared'

type AnchorPreservingKind = Extract<
  ViewportTransactionKind,
  'removeFromStart' | 'anchorRisk'
>

export async function runRemoveFromStartTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
): Promise<void> {
  return runAnchorPreservingMutationTransaction(
    deps,
    'removeFromStart',
    'viewport-modifier-remove-from-start',
  )
}

export async function runAnchorRiskTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
): Promise<void> {
  return runAnchorPreservingMutationTransaction(
    deps,
    'anchorRisk',
    'viewport-modifier-anchor-risk',
  )
}

export async function runItemLocationTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
): Promise<void> {
  const data = deps.getDataSnapshot()

  if (!data?.anchor) {
    deps.emitError('viewport-modifier-item-location-anchor-missing')
    deps.setPendingBootstrap({ type: 'bootstrap', mode: 'latest' })
    deps.tryRunPendingBootstrap()
    return
  }

  return runAnchorRestoreTransaction(deps, data.anchor, {
    transactionKind: 'itemLocation',
    missingTargetErrorCode: 'viewport-modifier-item-location-target-missing',
    missingDomErrorCode: 'viewport-modifier-item-location-dom-missing',
    updateDestinationState: false,
  })
}

export async function runIdentityRebindTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  const remaps = getValidIdentityRemaps(data.change.identityRemaps)

  if (remaps.length === 0) {
    deps.emitError('viewport-modifier-identity-remap-remaps-missing')
    await runAnchorlessReservedRefresh(deps, 'identityRebind')
    return
  }

  const capturedAnchor = deps.anchor.captureViewportAnchor()
  const anchorBefore = capturedAnchor
    ? {
        anchor: migrateAnchorState(capturedAnchor, remaps),
        top: deps.registry.getRow(capturedAnchor.key)?.getBoundingClientRect()
          .top,
      }
    : null

  for (const remap of remaps) {
    deps.registry.migrateRowKey(remap.from, remap.to)
    deps.measurement.migrateKey(remap.from, remap.to)
  }

  deps.renderWindow.invalidateIndexCache()
  deps.invalidateSpacerCache()

  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  const previousSnapshot = deps.store.getSnapshot()
  const token = deps.lifecycle.getCurrent()
  const anchorIndex = anchorBefore
    ? deps.renderWindow.findIndexByKey(data.items, anchorBefore.anchor.key)
    : -1
  const renderWindow =
    anchorIndex >= 0
      ? deps.renderWindow.computeWindowAroundAnchor({
          items: data.items,
          anchorIndex,
          viewportHeight: container.clientHeight,
          viewportWidth: container.clientWidth,
        })
      : getFallbackRenderWindow(deps, data, container)

  deps.setTransactionState('active')
  deps.setViewportPhase('PROJECTING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: previousSnapshot.bootstrapState,
      bottomLockState: previousBottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'identityRebind')

    if (anchorBefore && anchorIndex >= 0) {
      await correctPreservedAnchorAfterCommit(deps, {
        data,
        container,
        renderWindow,
        target: {
          key: anchorBefore.anchor.key,
          offsetWithinMessage: anchorBefore.anchor.offsetWithinMessage,
          index: anchorIndex,
        },
        anchorTopBefore:
          typeof anchorBefore.top === 'number' ? anchorBefore.top : null,
        missingDomErrorCode: 'viewport-modifier-identity-remap-anchor-dom-missing',
      })
    } else {
      deps.measureCurrentWindow()
    }

    settleReservedTransaction(deps, data, renderWindow, previousSnapshot.bootstrapState)
    deps.emitViewportAnchorChanged('transaction-settle', anchorBefore?.anchor)
  } catch (error) {
    deps.recoverAfterCommitFailure({
      token,
      nextState: 'READY',
      restoreBottomLockState: previousBottomLockState,
      restoreSnapshot: previousSnapshot,
    })
    deps.setTransactionState('idle')
    throw error
  }
}

async function runAnchorPreservingMutationTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  transactionKind: AnchorPreservingKind,
  errorPrefix: string,
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  const anchor = deps.anchor.captureViewportAnchor()

  if (!anchor) {
    deps.emitError(`${errorPrefix}-anchor-missing`)
    await runAnchorlessReservedRefresh(deps, transactionKind)
    return
  }

  const target = deps.anchor.resolveRestoreTarget(data, anchor)

  if (!target) {
    const fallback = data.anchor
      ? deps.anchor.resolveRestoreTarget(data, data.anchor)
      : null

    if (fallback) {
      deps.emitError(`${errorPrefix}-anchor-fallback`)
      await runAnchorRestoreTransaction(deps, data.anchor, {
        transactionKind,
        missingTargetErrorCode: `${errorPrefix}-target-missing`,
        missingDomErrorCode: `${errorPrefix}-dom-missing`,
        updateDestinationState: false,
      })
      return
    }

    deps.emitError(`${errorPrefix}-anchor-missing`)
    await runAnchorlessReservedRefresh(deps, transactionKind)
    return
  }

  const anchorTopBefore = deps.registry.getRow(anchor.key)?.getBoundingClientRect()
    .top
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  const previousSnapshot = deps.store.getSnapshot()
  const token = deps.lifecycle.getCurrent()
  const renderWindow = deps.renderWindow.computeWindowAroundAnchor({
    items: data.items,
    anchorIndex: target.index,
    viewportHeight: container.clientHeight,
    viewportWidth: container.clientWidth,
  })

  deps.setTransactionState('active')
  deps.setViewportPhase('PROJECTING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: previousSnapshot.bootstrapState,
      bottomLockState: previousBottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, transactionKind)
    await correctPreservedAnchorAfterCommit(deps, {
      data,
      container,
      renderWindow,
      target,
      anchorTopBefore: typeof anchorTopBefore === 'number' ? anchorTopBefore : null,
      missingDomErrorCode: `${errorPrefix}-dom-missing`,
    })
    settleReservedTransaction(
      deps,
      data,
      renderWindow,
      previousSnapshot.bootstrapState,
    )
    deps.emitViewportAnchorChanged('transaction-settle', anchor)
  } catch (error) {
    deps.recoverAfterCommitFailure({
      token,
      nextState: 'READY',
      restoreBottomLockState: previousBottomLockState,
      restoreSnapshot: previousSnapshot,
    })
    deps.setTransactionState('idle')
    throw error
  }
}

function migrateAnchorState(
  anchor: AnchorState,
  remaps: MessageIdentityRemap[],
): AnchorState {
  const remappedKey = remapKey(anchor.key, remaps)

  if (areRuntimeItemKeysEqual(remappedKey, anchor.key)) {
    return anchor
  }

  return {
    ...anchor,
    key: remappedKey,
  }
}

function remapKey(
  key: MessageRuntimeItemKey,
  remaps: MessageIdentityRemap[],
): MessageRuntimeItemKey {
  if (key.kind !== 'optimistic') {
    return key
  }

  const serializedKey = serializeRuntimeItemKey(key)
  const remap = remaps.find(
    (candidate) => serializeRuntimeItemKey(candidate.from) === serializedKey,
  )

  return remap?.to ?? key
}

function getValidIdentityRemaps(
  remaps: MessageIdentityRemap[] | undefined,
): MessageIdentityRemap[] {
  return (remaps ?? []).filter(
    (remap) =>
      remap.from?.kind === 'optimistic' &&
      remap.to?.kind === 'committed' &&
      serializeRuntimeItemKey(remap.from) !== serializeRuntimeItemKey(remap.to),
  )
}
