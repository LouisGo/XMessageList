import type { AnchorState, MessageDataSnapshot, MessageViewportSnapshot } from '../types'
import type { ViewportTransactionDeps } from './viewportTransactionController'

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
      target ?? data.anchor,
      token,
      previousSnapshot,
    )
  }

  deps.emitError(`bootstrap-${mode}-not-implemented`)
  return Promise.resolve()
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

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'MOUNTING',
      bottomLockState: 'UNLOCKED',
    })

    await deps.commit.waitForChanged(projection, 'bootstrap')
    deps.measureCurrentWindow()
    // latest bootstrap 先按估算窗口吸底，再等异步高度稳定后用实测结果二次校正。
    deps.motion.scrollToBottom('followBottom')
    await deps.waitForBootstrapSettle(data.feedId, data.generation)
    deps.measureCurrentWindow()
    deps.motion.scrollToBottom('followBottom')
    deps.scrollIntent.setBottomLockState('LOCKED')
    deps.setState('READY')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'LOCKED',
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

async function runRestoredBootstrap<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  container: HTMLElement,
  target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  token: { feedId: string; generation: number },
  previousSnapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): Promise<void> {
  const restoreTarget = deps.anchor.resolveRestoreTarget(data, target)

  if (!restoreTarget) {
    deps.emitError('bootstrap-restored-target-missing')
    deps.setState(deps.deriveRuntimeStateFromSnapshot(previousSnapshot))
    return
  }

  const renderWindow = deps.renderWindow.computeWindowAroundAnchor({
    items: data.items,
    anchorIndex: restoreTarget.index,
    viewportHeight: container.clientHeight,
    viewportWidth: container.clientWidth,
  })

  deps.setState('BOOTSTRAPPING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'MOUNTING',
      bottomLockState: 'UNLOCKED',
    })

    await deps.commit.waitForChanged(projection, 'bootstrap')

    const resolvedRestoreTarget =
      deps.anchor.getDirectMeasurableRow(restoreTarget.key) ??
      (await deps.anchor.resolveMeasurableRowForTarget({
        data,
        targetKey: restoreTarget.key,
        targetIndex: restoreTarget.index,
        renderWindow,
        missingDomErrorCode: 'bootstrap-restored-target-dom-missing',
      }))

    if (!resolvedRestoreTarget) {
      deps.recoverAfterCommitFailure({
        token,
        nextState: deps.deriveRuntimeStateFromSnapshot(previousSnapshot),
        restoreBottomLockState: previousSnapshot.bottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      return
    }

    // restored bootstrap 对齐的是视觉 anchor + offset，不是简单把目标消息滚到顶部。
    deps.anchor.alignToResolvedRestoreTarget(
      container,
      restoreTarget,
      resolvedRestoreTarget,
    )
    deps.measureCurrentWindow()
    deps.scrollIntent.setBottomLockState('UNLOCKED')
    deps.setState('READY')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'UNLOCKED',
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
