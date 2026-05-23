import type { AnchorState, MessageDataSnapshot, MessageViewportSnapshot } from '../types'
import type { ViewportTransactionDeps } from './viewportTransactionController'
import {
  runRestoredBootstrap,
  runUnreadBootstrap,
} from './bootstrapAnchorTransactions'
import { assertBootstrapPolicy } from './bootstrapPhasePolicy'

export function runBootstrapTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  mode: 'latest' | 'unread' | 'restored',
  target?: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return Promise.resolve()
  }

  const token = deps.lifecycle.getCurrent()
  const previousSnapshot = deps.store.getSnapshot()

  if (data.items.length === 0) {
    // 空 feed 仍然是稳定 READY 状态；不要留下 MOUNTING，否则 React shell 会一直等待 commit。
    deps.projection.publish({
      data,
      renderWindow: deps.renderWindow.computeLatestWindow(
        data.items,
        container.clientHeight,
        container.clientWidth,
      ),
      topSpacer: 0,
      bottomSpacer: 0,
      bootstrapState: 'READY_EMPTY',
      bottomLockState: 'LOCKED',
      viewportPhase: 'IDLE',
    })
    deps.setState('READY')
    deps.emitEvent({
      type: 'viewportReady',
      feedId: data.feedId,
      generation: data.generation,
    })
    return Promise.resolve()
  }

  if (mode === 'latest') {
    return runLatestBootstrap(deps, data, container, token, previousSnapshot)
  }

  if (mode === 'restored') {
    return runRestoredBootstrap(
      deps,
      data,
      container,
      getBootstrapTarget(data, target),
      token,
      previousSnapshot,
    )
  }

  return runUnreadBootstrap(
    deps,
    data,
    container,
    getBootstrapTarget(data, target),
    token,
    previousSnapshot,
  )
}

async function runLatestBootstrap<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  container: HTMLElement,
  token: { feedId: string; generation: number },
  previousSnapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): Promise<void> {
  const renderWindow = deps.renderWindow.computeLatestWindow(
    data.items,
    container.clientHeight,
    container.clientWidth,
  )

  deps.setState('BOOTSTRAPPING')
  deps.setViewportPhase('PROJECTING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'MOUNTING',
      bottomLockState: 'UNLOCKED',
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'bootstrap')
    assertBootstrapPolicy('MEASURING', 'measurement')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'MEASURING',
      bottomLockState: 'UNLOCKED',
      viewportPhase: 'MEASURING',
    })
    deps.measureCurrentWindow()
    // latest bootstrap 先按估算窗口吸底，再等异步高度稳定后用实测结果二次校正。
    assertBootstrapPolicy('STABILIZING', 'correction')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'STABILIZING',
      bottomLockState: 'UNLOCKED',
      viewportPhase: 'CORRECTING',
    })
    deps.motion.scrollToBottom('followBottom')
    await deps.waitForBootstrapSettle(data.feedId, data.generation)
    deps.measureCurrentWindow()
    deps.motion.scrollToBottom('followBottom')
    deps.scrollIntent.setBottomLockState('LOCKED')
    deps.setViewportPhase('IDLE')
    deps.setState('READY')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'LOCKED',
      viewportPhase: 'IDLE',
    })
    deps.emitViewportAnchorChanged('transaction-settle')
    deps.emitEvent({
      type: 'viewportReady',
      feedId: data.feedId,
      generation: data.generation,
    })
  } catch (error) {
    deps.recoverAfterCommitFailure({
      token,
      nextState: deps.deriveRuntimeStateFromSnapshot(previousSnapshot),
      restoreBottomLockState: previousSnapshot.bottomLockState,
      restoreSnapshot: previousSnapshot,
    })
    throw error
  }
}

function getBootstrapTarget<TMessage, TOptimistic>(
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
): AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'] {
  if (data.anchorStatus === 'deleted' && data.anchor) {
    return data.anchor
  }

  return target ?? data.anchor
}
