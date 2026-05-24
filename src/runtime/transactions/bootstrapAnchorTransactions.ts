import type { AnchorState, MessageDataSnapshot, MessageViewportSnapshot } from '../types'
import { areRuntimeItemKeysEqual } from '../shared/utils'
import type { ViewportTransactionDeps } from './viewportTransactionController'
import { assertBootstrapPolicy } from './bootstrapPhasePolicy'
import {
  resolveMeasuredTarget,
} from './measurementReadinessBarrier'

export async function runRestoredBootstrap<TMessage, TOptimistic>(
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

    const restoredResult = resolveMeasuredTarget(deps, {
      data,
      targetKey: restoreTarget.key,
      targetIndex: restoreTarget.index,
      renderWindow,
      missingDomErrorCode: 'bootstrap-restored-target-dom-missing',
      transactionKind: 'bootstrap',
    })
    const resolvedRestoreTarget =
      restoredResult instanceof Promise ? await restoredResult : restoredResult

    if (!resolvedRestoreTarget) {
      deps.recoverAfterCommitFailure({
        token,
        nextState: deps.deriveRuntimeStateFromSnapshot(previousSnapshot),
        restoreBottomLockState: previousSnapshot.bottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      return
    }

    const settledAnchor = {
      key: resolvedRestoreTarget.key,
      offsetWithinMessage: areRuntimeItemKeysEqual(
        resolvedRestoreTarget.key,
        restoreTarget.key,
      )
        ? restoreTarget.offsetWithinMessage
        : 0,
    }

    // restored bootstrap 对齐的是视觉 anchor + offset，不是简单把目标消息滚到顶部。
    assertBootstrapPolicy('STABILIZING', 'correction')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'STABILIZING',
      bottomLockState: 'UNLOCKED',
      viewportPhase: 'CORRECTING',
    })
    deps.anchor.alignToResolvedRestoreTarget(
      container,
      restoreTarget,
      resolvedRestoreTarget,
    )
    deps.scrollIntent.setBottomLockState('UNLOCKED')
    deps.reconcileBottomLockFromViewport(data, 'restored-bootstrap-settle')
    deps.setViewportPhase('IDLE')
    deps.setState('READY')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: deps.scrollIntent.getBottomLockState(),
      viewportPhase: 'IDLE',
    })
    deps.emitViewportAnchorChanged('transaction-settle', settledAnchor)
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

export async function runUnreadBootstrap<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  container: HTMLElement,
  target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  token: { feedId: string; generation: number },
  previousSnapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): Promise<void> {
  const unreadTarget = deps.anchor.resolveRestoreTarget(data, target)

  if (!unreadTarget) {
    deps.emitError('bootstrap-unread-target-missing')
    deps.setState(deps.deriveRuntimeStateFromSnapshot(previousSnapshot))
    return
  }

  const renderWindow = deps.renderWindow.computeWindowAroundAnchor({
    items: data.items,
    anchorIndex: unreadTarget.index,
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

    const unreadResult = resolveMeasuredTarget(deps, {
      data,
      targetKey: unreadTarget.key,
      targetIndex: unreadTarget.index,
      renderWindow,
      missingDomErrorCode: 'bootstrap-unread-target-dom-missing',
      transactionKind: 'bootstrap',
    })
    const resolvedUnreadTarget =
      unreadResult instanceof Promise ? await unreadResult : unreadResult

    if (!resolvedUnreadTarget) {
      deps.recoverAfterCommitFailure({
        token,
        nextState: deps.deriveRuntimeStateFromSnapshot(previousSnapshot),
        restoreBottomLockState: previousSnapshot.bottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      return
    }

    assertBootstrapPolicy('STABILIZING', 'correction')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'STABILIZING',
      bottomLockState: 'UNLOCKED',
      viewportPhase: 'CORRECTING',
    })
    deps.anchor.alignToResolvedTargetAtViewportOffset(
      container,
      unreadTarget,
      resolvedUnreadTarget,
      getUnreadViewportOffset(container),
    )
    deps.scrollIntent.setBottomLockState('UNLOCKED')
    deps.setViewportPhase('IDLE')
    deps.setState('READY')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'UNLOCKED',
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

function getUnreadViewportOffset(container: HTMLElement): number {
  return Math.floor(container.clientHeight * 0.4)
}
