import type { ViewportTransactionDeps } from './viewportTransactionController'
import type {
  AnchorState,
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
  ViewportTransactionKind,
} from '../types'
import type { DestinationMotionForcedStart } from '../core/state/runtimeTypes'
import { createSettledRestoreAnchor, getJumpResolution } from './transactionShared'
import { resolveMeasuredTarget } from './measurementReadinessBarrier'

export async function runJumpTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  targetAnchor: MessageIdentityAnchor,
  options: {
    forceAnimateFrom?: DestinationMotionForcedStart
    allowPreposition?: boolean
    animate?: boolean
    originalTarget?: MessageIdentityAnchor
  } = {},
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  const messageId = targetAnchor.messageId
  const targetIndex = deps.renderWindow.findCommittedMessageIndex(
    data.items,
    messageId,
  )

  if (targetIndex < 0) {
    deps.emitError('jump-target-missing')
    return
  }

  const token = deps.lifecycle.getCurrent()
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  const previousSnapshot = deps.store.getSnapshot()
  const targetKey: MessageRuntimeItemKey = { kind: 'committed', messageId }
  const renderWindow = deps.renderWindow.computeWindowAroundAnchor({
    items: data.items,
    anchorIndex: targetIndex,
    viewportHeight: container.clientHeight,
    viewportWidth: container.clientWidth,
  })

  deps.setTransactionState('active')
  deps.setDestinationState('resolvingDom')
  deps.setViewportPhase('PROJECTING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: previousBottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'jump')
    deps.setDestinationState('resolvingDom')
    const targetResult = resolveMeasuredTarget(deps, {
      data,
      targetKey,
      targetIndex,
      renderWindow,
      missingDomErrorCode: 'jump-target-dom-missing',
      transactionKind: 'jump',
    })
    const target = targetResult instanceof Promise ? await targetResult : targetResult

    if (!target) {
      deps.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
        restoreBottomLockState: previousBottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      deps.setDestinationState('idle')
      deps.setTransactionState('idle')
      return
    }

    const containerRect = container.getBoundingClientRect()
    const targetRect = target.element.getBoundingClientRect()
    const centerDelta =
      targetRect.top -
      containerRect.top -
      Math.max(0, (container.clientHeight - targetRect.height) / 2)

    const targetTop = container.scrollTop + centerDelta

    if (options.animate === false) {
      deps.motion.scrollTo('jump', targetTop)
      deps.scrollIntent.setBottomLockState('UNLOCKED')
      deps.setDestinationState('settled')
      deps.setViewportPhase('IDLE')
      deps.setTransactionState('idle')
      deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: deps.store.getSnapshot().bootstrapState,
        bottomLockState: 'UNLOCKED',
        viewportPhase: 'IDLE',
      })
      deps.emitDestinationSettled({
        intent: 'jump',
        target: options.originalTarget ?? targetAnchor,
        resolution: getJumpResolution(options.originalTarget, targetAnchor),
        resolvedTarget: targetAnchor,
      })
      deps.emitViewportAnchorChanged('transaction-settle')
      return
    }

    deps.setDestinationState('motionActive')
    deps.motion.start({
      source: 'jump',
      targetTop,
      data,
      renderWindow,
      bottomLockState: 'UNLOCKED',
      forceAnimateFrom: options.forceAnimateFrom,
      allowPreposition: options.allowPreposition,
      destination: {
        intent: 'jump',
        target: options.originalTarget ?? targetAnchor,
        resolution: getJumpResolution(options.originalTarget, targetAnchor),
        resolvedTarget: targetAnchor,
      },
    })
    deps.setTransactionState('idle')
  } catch (error) {
    deps.recoverAfterCommitFailure({
      token,
      nextState: 'READY',
      restoreBottomLockState: previousBottomLockState,
      restoreSnapshot: previousSnapshot,
    })
    deps.setDestinationState('idle')
    deps.setTransactionState('idle')
    throw error
  }
}

export async function runRestoreTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
): Promise<void> {
  return runAnchorRestoreTransaction(deps, target, {
    transactionKind: 'restore',
    missingTargetErrorCode: 'restore-target-missing',
    missingDomErrorCode: 'restore-target-dom-missing',
    updateDestinationState: true,
  })
}

export async function runViewportCompactionTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
): Promise<void> {
  return runAnchorRestoreTransaction(deps, target, {
    transactionKind: 'viewportCompaction',
    missingTargetErrorCode: 'viewport-compaction-target-missing',
    missingDomErrorCode: 'viewport-compaction-target-dom-missing',
    updateDestinationState: false,
  })
}

export async function runAnchorRestoreTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  options: {
    transactionKind: ViewportTransactionKind
    missingTargetErrorCode: string
    missingDomErrorCode: string
    updateDestinationState: boolean
  },
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  const restoreTarget = deps.anchor.resolveRestoreTarget(data, target)

  if (!restoreTarget) {
    deps.emitError(options.missingTargetErrorCode)
    return
  }

  const token = deps.lifecycle.getCurrent()
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  const previousSnapshot = deps.store.getSnapshot()
  const renderWindow = deps.renderWindow.computeWindowAroundAnchor({
    items: data.items,
    anchorIndex: restoreTarget.index,
    viewportHeight: container.clientHeight,
    viewportWidth: container.clientWidth,
  })

  deps.setTransactionState('active')
  if (options.updateDestinationState) {
    deps.setDestinationState('resolvingDom')
  }
  deps.setViewportPhase('PROJECTING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: previousBottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, options.transactionKind)
    if (options.updateDestinationState) {
      deps.setDestinationState('resolvingDom')
    }

    const resolvedResult = resolveMeasuredTarget(deps, {
      data,
      targetKey: restoreTarget.key,
      targetIndex: restoreTarget.index,
      renderWindow,
      missingDomErrorCode: options.missingDomErrorCode,
      transactionKind: options.transactionKind,
    })
    const resolvedRestoreTarget =
      resolvedResult instanceof Promise ? await resolvedResult : resolvedResult

    if (!resolvedRestoreTarget) {
      deps.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
        restoreBottomLockState: previousBottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      if (options.updateDestinationState) {
        deps.setDestinationState('idle')
      }
      deps.setTransactionState('idle')
      return
    }

    if (options.updateDestinationState) {
      deps.setDestinationState('resolvingDom')
    }
    deps.setViewportPhase('CORRECTING')
    deps.anchor.alignToResolvedRestoreTarget(
      container,
      restoreTarget,
      resolvedRestoreTarget,
    )
    deps.scrollIntent.setBottomLockState('UNLOCKED')
    deps.reconcileBottomLockFromViewport(data, `${options.transactionKind}-settle`)
    if (options.updateDestinationState) {
      deps.setDestinationState('settled')
    }
    deps.setViewportPhase('IDLE')
    deps.setTransactionState('idle')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: deps.scrollIntent.getBottomLockState(),
      viewportPhase: 'IDLE',
    })
    deps.emitViewportAnchorChanged(
      'transaction-settle',
      createSettledRestoreAnchor(restoreTarget, resolvedRestoreTarget),
    )
  } catch (error) {
    deps.recoverAfterCommitFailure({
      token,
      nextState: 'READY',
      restoreBottomLockState: previousBottomLockState,
      restoreSnapshot: previousSnapshot,
    })
    if (options.updateDestinationState) {
      deps.setDestinationState('idle')
    }
    deps.setTransactionState('idle')
    throw error
  }
}
