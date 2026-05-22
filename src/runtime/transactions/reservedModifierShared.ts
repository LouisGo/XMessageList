import type {
  BootstrapState,
  MessageDataSnapshot,
  RenderWindow,
  ViewportTransactionKind,
} from '../types'
import type { RestoreTarget } from '../core/state/runtimeTypes'
import type { ViewportTransactionDeps } from './viewportTransactionController'

export async function correctPreservedAnchorAfterCommit<
  TMessage,
  TOptimistic,
>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    container: HTMLElement
    renderWindow: RenderWindow
    target: RestoreTarget
    anchorTopBefore: number | null
    missingDomErrorCode: string
  },
): Promise<void> {
  const anchorElementAfter = deps.registry.getRow(input.target.key)
  const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

  deps.measureCurrentWindow()

  if (
    typeof input.anchorTopBefore === 'number' &&
    typeof anchorTopAfter === 'number'
  ) {
    const delta = anchorTopAfter - input.anchorTopBefore
    deps.setViewportPhase('CORRECTING')

    if (Math.abs(delta) > 0.5) {
      deps.motion.writeScrollTop(input.container.scrollTop + delta, 'recovery')
    }
    return
  }

  const resolved =
    deps.anchor.getDirectMeasurableRow(input.target.key) ??
    (await deps.anchor.resolveMeasurableRowForTarget({
      data: input.data,
      targetKey: input.target.key,
      targetIndex: input.target.index,
      renderWindow: input.renderWindow,
      missingDomErrorCode: input.missingDomErrorCode,
    }))

  if (!resolved) {
    return
  }

  deps.setViewportPhase('CORRECTING')
  deps.anchor.alignToResolvedRestoreTarget(
    input.container,
    input.target,
    resolved,
  )
}

export async function runAnchorlessReservedRefresh<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  transactionKind: ViewportTransactionKind,
): Promise<void> {
  const container = deps.registry.getContainer()

  if (!container) {
    return
  }

  const previousSnapshot = deps.store.getSnapshot()
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  const token = deps.lifecycle.getCurrent()
  const renderWindow = getFallbackRenderWindow(deps, data, container)

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
    deps.measureCurrentWindow()
    settleReservedTransaction(
      deps,
      data,
      renderWindow,
      previousSnapshot.bootstrapState,
    )
    deps.emitViewportAnchorChanged('transaction-settle', null)
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

export function settleReservedTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  renderWindow: RenderWindow,
  bootstrapState: BootstrapState,
): void {
  deps.reconcileBottomLockFromViewport(data, 'reserved-modifier-settle')
  deps.setViewportPhase('IDLE')
  deps.setTransactionState('idle')
  deps.projection.publish({
    data,
    renderWindow,
    bootstrapState,
    bottomLockState: deps.scrollIntent.getBottomLockState(),
    viewportPhase: 'IDLE',
  })
}

export function getFallbackRenderWindow<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  container: HTMLElement,
): RenderWindow {
  const snapshot = deps.store.getSnapshot()

  if (snapshot.renderWindow.endIndex >= snapshot.renderWindow.startIndex) {
    return deps.keepCurrentWindow(data.items)
  }

  return deps.renderWindow.computeLatestWindow(
    data.items,
    container.clientHeight,
    container.clientWidth,
  )
}
