import type { ViewportTransactionDeps } from './viewportTransactionController'
import type { RenderWindow } from '../types'

export async function runAnchorlessWindowSlideTransaction<
  TMessage,
  TOptimistic,
>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  nextWindow: RenderWindow,
  expectedData: { feedId: string; generation: number; revision: number },
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  if (
    data.feedId !== expectedData.feedId ||
    data.generation !== expectedData.generation ||
    data.revision !== expectedData.revision
  ) {
    return
  }

  const token = deps.lifecycle.getCurrent()
  const previousSnapshot = deps.store.getSnapshot()
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  deps.setViewportPhase('PROJECTING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow: nextWindow,
      bootstrapState: previousSnapshot.bootstrapState,
      bottomLockState: previousBottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'resize')
    deps.measureCurrentWindow()
    deps.setViewportPhase('IDLE')
    deps.projection.publish({
      data,
      renderWindow: nextWindow,
      bootstrapState: previousSnapshot.bootstrapState,
      bottomLockState: deps.scrollIntent.getBottomLockState(),
      viewportPhase: 'IDLE',
    })
    deps.emitViewportAnchorChanged(
      'transaction-settle',
      deps.anchor.captureViewportAnchor(),
    )
  } catch (error) {
    deps.recoverAfterCommitFailure({
      token,
      nextState: 'READY',
      restoreBottomLockState: previousBottomLockState,
      restoreSnapshot: previousSnapshot,
    })
    throw error
  }
}
