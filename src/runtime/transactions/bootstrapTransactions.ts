import type { AnchorState, MessageDataSnapshot, MessageViewportSnapshot } from '../types'
import type { ViewportTransactionDeps } from './viewportTransactionController'
import { areRuntimeItemKeysEqual } from '../shared/utils'

/**
 * Bootstrap 阶段许可表：
 * MOUNTING 只允许首次 projection 和 commit wait；
 * MEASURING 只允许读取 DOM/height，不允许 correction、trim、分页触发；
 * STABILIZING 允许首屏必要 correction，但仍禁止 trim 和外部分页触发；
 * READY 才恢复普通 viewport effects。
 */
const BOOTSTRAP_PHASE_POLICY = {
  MOUNTING: {
    projection: true,
    measurement: false,
    correction: false,
    trim: false,
    edgeNeed: false,
  },
  MEASURING: {
    projection: true,
    measurement: true,
    correction: false,
    trim: false,
    edgeNeed: false,
  },
  STABILIZING: {
    projection: true,
    measurement: true,
    correction: true,
    trim: false,
    edgeNeed: false,
  },
  READY: {
    projection: true,
    measurement: true,
    correction: true,
    trim: true,
    edgeNeed: true,
  },
} as const

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

    const settledAnchor = {
      key: resolvedRestoreTarget.key,
      offsetWithinMessage: areRuntimeItemKeysEqual(
        resolvedRestoreTarget.key,
        restoreTarget.key,
      )
        ? restoreTarget.offsetWithinMessage
        : 0,
    }

    deps.measureCurrentWindow()
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

function assertBootstrapPolicy(
  phase: keyof typeof BOOTSTRAP_PHASE_POLICY,
  capability: keyof typeof BOOTSTRAP_PHASE_POLICY.READY,
): void {
  if (!BOOTSTRAP_PHASE_POLICY[phase][capability]) {
    throw new Error(`bootstrap-${phase}-forbids-${capability}`)
  }
}
