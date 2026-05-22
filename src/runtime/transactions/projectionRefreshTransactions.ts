import type { AnchorState } from '../types'
import type { ViewportTransactionDeps } from './viewportTransactionController'

export async function runProjectionRefreshTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  deps.reconcileBottomLockFromViewport(data, 'refresh-before-follow-check')
  const hasActiveFollowBottomIntent = deps.hasActiveFollowBottomIntent(data)
  const shouldFollowBottom =
    !data.hasMoreAfter &&
    (deps.scrollIntent.getBottomLockState() === 'LOCKED' ||
      hasActiveFollowBottomIntent)
  const snapshot = deps.store.getSnapshot()
  const renderWindow = shouldFollowBottom
    ? deps.renderWindow.computeLatestWindow(
        data.items,
        container.clientHeight,
        container.clientWidth,
      )
    : snapshot.renderWindow.endIndex >= snapshot.renderWindow.startIndex
      ? deps.keepCurrentWindow(data.items)
      : deps.renderWindow.computeLatestWindow(
          data.items,
          container.clientHeight,
          container.clientWidth,
        )

  if (shouldFollowBottom) {
    deps.setTransactionState('active')
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: snapshot.bootstrapState,
      bottomLockState: snapshot.bottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'resize')
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
    deps.setViewportPhase('IDLE')
    deps.setTransactionState('idle')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: snapshot.bootstrapState,
      bottomLockState: 'LOCKED',
      viewportPhase: 'IDLE',
    })
    deps.emitViewportAnchorChanged('transaction-settle')
    return
  }

  const anchor = deps.anchor.captureViewportAnchor()
  const anchorElementBefore = anchor ? deps.registry.getRow(anchor.key) : null
  const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top
  deps.setTransactionState('active')
  deps.setViewportPhase('PROJECTING')
  const projection = deps.projection.publish({
    data,
    renderWindow,
    bootstrapState: snapshot.bootstrapState,
    bottomLockState: snapshot.bottomLockState,
    viewportPhase: 'PROJECTING',
  })

  await deps.commit.waitForChanged(projection, 'resize')

  let settledAnchor: AnchorState | null | undefined

  if (anchor && typeof anchorTopBefore === 'number') {
    // 普通 refresh 不改变用户正在看的 anchor；只在 commit 后 DOM 真正更新时补偿滚动。
    const anchorElementAfter = deps.registry.getRow(anchor.key)
    const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top
    deps.measureCurrentWindow()

    if (typeof anchorTopAfter === 'number') {
      const delta = anchorTopAfter - anchorTopBefore
      deps.setViewportPhase('CORRECTING')

      if (Math.abs(delta) > 0.5) {
        deps.motion.writeScrollTop(container.scrollTop + delta, 'recovery')
      }
      settledAnchor = anchor
    }
  } else {
    deps.measureCurrentWindow()
  }

  deps.setViewportPhase('IDLE')
  deps.projection.publish({
    data,
    renderWindow,
    bootstrapState: snapshot.bootstrapState,
    bottomLockState: deps.scrollIntent.getBottomLockState(),
    viewportPhase: 'IDLE',
  })
  deps.emitViewportAnchorChanged('transaction-settle', settledAnchor)
}
