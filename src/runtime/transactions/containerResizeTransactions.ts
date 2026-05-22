import type { ContainerSize } from '../core/state/runtimeTypes'
import type { ViewportTransactionDeps } from './viewportTransactionController'

export async function runContainerResizeTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  previousSize: ContainerSize,
  nextSize: ContainerSize,
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  const token = deps.lifecycle.getCurrent()
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  const previousSnapshot = deps.store.getSnapshot()
  const anchor = deps.anchor.captureViewportAnchor()
  const anchorElementBefore = anchor ? deps.registry.getRow(anchor.key) : null
  const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top
  const widthInvalidated = deps.measurement.invalidateForWidth(nextSize.width)
  if (widthInvalidated) {
    deps.invalidateSpacerCache()
  }
  // 宽度变化会让文本换行和高度估算整体失效，必须先清 height cache 再计算新 window。
  const anchorIndex = anchor
    ? deps.renderWindow.findIndexByKey(data.items, anchor.key)
    : -1
  const hasActiveFollowBottomIntent = deps.hasActiveFollowBottomIntent(data)
  const shouldFollowBottom =
    !data.hasMoreAfter &&
    (previousBottomLockState === 'LOCKED' || hasActiveFollowBottomIntent)
  const renderWindow = shouldFollowBottom
    ? deps.renderWindow.computeLatestWindow(
        data.items,
        nextSize.height,
        nextSize.width,
      )
    : anchorIndex >= 0
      ? deps.renderWindow.computeWindowAroundAnchor({
          items: data.items,
          anchorIndex,
          viewportHeight: nextSize.height,
          viewportWidth: nextSize.width,
        })
      : deps.keepCurrentWindow(data.items)
  const sizeChanged =
    previousSize.width !== nextSize.width || previousSize.height !== nextSize.height
  const projectionNeeded =
    widthInvalidated ||
    sizeChanged ||
    !deps.projection.isRenderWindowEqual(
      previousSnapshot.renderWindow,
      renderWindow,
    )

  if (!projectionNeeded) {
    return
  }

  deps.setViewportPhase('PROJECTING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: previousSnapshot.bootstrapState,
      bottomLockState: previousBottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'resize')
    const anchorElementAfter =
      !shouldFollowBottom && anchor ? deps.registry.getRow(anchor.key) : null
    const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top
    deps.measureCurrentWindow()

    if (shouldFollowBottom) {
      if (hasActiveFollowBottomIntent) {
        deps.setDestinationState('resolvingDom')
        deps.motion.start({
          source: 'followBottom',
          targetTop: deps.motion.getBottomTargetTop(container),
          data,
          renderWindow,
          bottomLockState: 'LOCKED',
        })
        deps.setTransactionState('idle')
        return
      }

      deps.motion.scrollToBottom('programmatic')
      deps.scrollIntent.setBottomLockState('LOCKED')
      deps.setDestinationState('settled')
      deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: previousSnapshot.bootstrapState,
        bottomLockState: 'LOCKED',
        viewportPhase: 'IDLE',
      })
    } else if (anchor && typeof anchorTopBefore === 'number') {
      if (typeof anchorTopAfter === 'number') {
        const delta = anchorTopAfter - anchorTopBefore
        deps.setTransactionState('settling')
        deps.setViewportPhase('CORRECTING')

        if (Math.abs(delta) > 0.5) {
          deps.motion.writeScrollTop(container.scrollTop + delta, 'recovery')
        }
      }
    }

    deps.setViewportPhase('IDLE')
    deps.setTransactionState('idle')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: previousSnapshot.bootstrapState,
      bottomLockState: deps.scrollIntent.getBottomLockState(),
      viewportPhase: 'IDLE',
    })
    deps.emitViewportAnchorChanged(
      'transaction-settle',
      shouldFollowBottom ? undefined : (anchor ?? undefined),
    )
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
