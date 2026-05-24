import type { ContainerSize } from '../core/state/runtimeTypes'
import type { ViewportTransactionDeps } from './viewportTransactionController'
import {
  captureAnchorTop,
  correctPreservedAnchorAfterCommit,
} from './scrollCorrectionLedger'

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
  const anchorTopBefore = anchor ? captureAnchorTop(deps, anchor.key) : null
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

    if (shouldFollowBottom) {
      deps.measureCurrentWindow()
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
    } else if (anchor && anchorIndex >= 0) {
      const correctionResult = correctPreservedAnchorAfterCommit(deps, {
        data,
        container,
        renderWindow,
        target: {
          key: anchor.key,
          offsetWithinMessage: anchor.offsetWithinMessage,
          index: anchorIndex,
        },
        anchorTopBefore,
        missingDomErrorCode: 'resize-anchor-after-missing',
        missingAnchorAfterPolicy: 'measure-only',
      })
      const correction =
        correctionResult instanceof Promise
          ? await correctionResult
          : correctionResult

      if (
        correction.status === 'applied' ||
        correction.status === 'within-epsilon'
      ) {
        deps.setTransactionState('settling')
      }
    } else {
      deps.measureCurrentWindow()
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
