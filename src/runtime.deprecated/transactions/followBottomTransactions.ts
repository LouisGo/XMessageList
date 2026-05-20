import type { ViewportTransactionDeps } from './viewportTransactionController'

export async function runFollowBottomTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  const dataCorrelationId =
    `data:${data.feedId}:${data.generation}:${data.revision}`
  deps.setTransactionState('active')
  deps.emitDiagnostic({
    channel: 'transaction',
    severity: 'info',
    name: 'followBottom.transaction',
    correlationId: dataCorrelationId,
    details: () => ({
      phase: 'begin',
      revision: data.revision,
      itemCount: data.items.length,
      hasMoreBefore: data.hasMoreBefore,
      hasMoreAfter: data.hasMoreAfter,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      bottomLockState: deps.scrollIntent.getBottomLockState(),
    }),
  })

  if (data.hasMoreAfter) {
    deps.emitDiagnostic({
      channel: 'transaction',
      severity: 'info',
      name: 'followBottom.transaction',
      correlationId: dataCorrelationId,
      details: () => ({
        phase: 'latest-needed',
        revision: data.revision,
        itemCount: data.items.length,
        scrollTop: container.scrollTop,
      }),
    })
    deps.startPendingFollowBottom(data, container.scrollTop)
    deps.setTransactionState('idle')
    return
  }

  const renderWindow = deps.renderWindow.computeLatestWindow(
    data.items,
    container.clientHeight,
    container.clientWidth,
  )
  const preProjectionScrollTop = container.scrollTop
  const token = deps.lifecycle.getCurrent()
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()

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

    await deps.commit.waitForChanged(projection, 'followBottom')
    deps.measureCurrentWindow()
    const targetTop = deps.motion.getBottomTargetTop(container)
    const forceAnimateFrom =
      Math.abs(targetTop - container.scrollTop) <= 1 &&
      preProjectionScrollTop > targetTop + 1
        ? 'beforeTarget' as const
        : undefined
    deps.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'followBottom.motionRequest',
      correlationId: dataCorrelationId,
      details: () => ({
        revision: data.revision,
        itemCount: data.items.length,
        renderWindowStart: renderWindow.startIndex,
        renderWindowEnd: renderWindow.endIndex,
        renderedItems: renderWindow.itemKeys.length,
        scrollTop: container.scrollTop,
        targetTop,
        distancePx: targetTop - container.scrollTop,
        preProjectionScrollTop,
        forceAnimateFrom,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        firstRenderedKey: renderWindow.itemKeys[0] ?? null,
        lastRenderedKey:
          renderWindow.itemKeys[renderWindow.itemKeys.length - 1] ?? null,
      }),
    })
    deps.motion.start({
      source: 'followBottom',
      targetTop,
      data,
      renderWindow,
      bottomLockState: 'LOCKED',
      forceAnimateFrom,
    })
    deps.setTransactionState('idle')
  } catch (error) {
    deps.clearActiveFollowBottomIntent('commit-timeout')
    deps.recoverAfterCommitFailure({
      token,
      nextState: 'READY',
      restoreBottomLockState: previousBottomLockState,
      restoreProjection: {
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: previousBottomLockState,
        viewportPhase: 'IDLE',
      },
    })
    deps.setTransactionState('idle')
    throw error
  }
}
