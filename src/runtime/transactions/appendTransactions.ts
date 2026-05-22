import type { MessageDataSnapshot, ScrollSource } from '../types'
import { shouldRunDataMutationTransaction } from './dataMutationTransaction'
import type { ViewportTransactionDeps } from './viewportTransactionController'

export async function runAppendTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
  effect: 'append' | 'auto-scroll-to-bottom',
): Promise<void> {
  const container = deps.registry.getContainer()

  if (!container || !shouldRunDataMutationTransaction(deps, data)) {
    return
  }

  // BottomLocked 只代表 feed latest 的底部；hasMoreAfter=true 时，
  // 当前物理底部只是已加载 DataWindow 的 after edge，不能被 append page 追底。
  deps.reconcileBottomLockFromViewport(data, 'append-before-follow-check')
  // 本地发送属于明确的追底意图。即使用户之前处于 UNLOCKED，
  // 后续 storm/resize 事务打断本次 motion，也必须继续追到底部。
  if (effect === 'auto-scroll-to-bottom') {
    deps.ensureActiveFollowBottomIntent(data, container.scrollTop)
  }

  const hasActiveFollowBottomIntent = deps.hasActiveFollowBottomIntent(data)
  const shouldFollow =
    !data.hasMoreAfter &&
    (effect === 'auto-scroll-to-bottom' ||
      deps.scrollIntent.getBottomLockState() === 'LOCKED' ||
      hasActiveFollowBottomIntent)
  const motionSource: Extract<ScrollSource, 'programmatic' | 'followBottom'> =
    hasActiveFollowBottomIntent ? 'followBottom' : 'programmatic'
  const token = deps.lifecycle.getCurrent()
  const renderWindow = shouldFollow
    ? deps.renderWindow.computeLatestWindow(
        data.items,
        container.clientHeight,
        container.clientWidth,
      )
    : deps.keepCurrentWindow(data.items)

  deps.setTransactionState('active')
  deps.setViewportPhase('PROJECTING')
  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: deps.scrollIntent.getBottomLockState(),
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'append')
    deps.measureCurrentWindow()

    if (shouldFollow) {
      deps.setDestinationState('resolvingDom')
      deps.motion.start({
        source: motionSource,
        targetTop: deps.motion.getBottomTargetTop(container),
        data,
        renderWindow,
        bottomLockState: 'LOCKED',
      })
      deps.setTransactionState('idle')
      return
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
    deps.emitViewportAnchorChanged('transaction-settle')
  } catch (error) {
    deps.recoverAfterCommitFailure({
      token,
      nextState: 'READY',
    })
    deps.setTransactionState('idle')
    throw error
  }
}
