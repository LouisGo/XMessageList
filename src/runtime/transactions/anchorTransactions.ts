import type { ViewportTransactionDeps } from './viewportTransactionController'
import type {
  AnchorState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageRuntimeItemKey,
  RenderWindow,
} from '../types'
import { shouldRunDataMutationTransaction } from './dataMutationTransaction'
import {
  captureAnchorTop,
  correctPreservedAnchorAfterCommit,
} from './scrollCorrectionLedger'

export async function runPrependTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  data: MessageDataSnapshot<TMessage, TOptimistic>,
): Promise<void> {
  const container = deps.registry.getContainer()

  if (!container || !shouldRunDataMutationTransaction(deps, data)) {
    return
  }

  const anchor = deps.anchor.captureViewportAnchor()

  if (!anchor) {
    deps.emitError('prepend-anchor-missing')
    return
  }

  const anchorTopBefore = captureAnchorTop(deps, anchor.key)

  if (anchorTopBefore === null) {
    deps.emitError('prepend-anchor-dom-missing')
    return
  }

  const anchorIndex = deps.renderWindow.findIndexByKey(data.items, anchor.key)
  const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : 0
  const token = deps.lifecycle.getCurrent()
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  const previousSnapshot = deps.store.getSnapshot()
  const renderWindow = deps.renderWindow.computeWindowAroundAnchor({
    items: data.items,
    anchorIndex: safeAnchorIndex,
    viewportHeight: container.clientHeight,
    viewportWidth: container.clientWidth,
  })

  deps.setTransactionState('active')
  deps.setViewportPhase('PROJECTING')

  try {
    const projection = deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: previousBottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'prepend')

    const correctionResult = correctPreservedAnchorAfterCommit(deps, {
      data,
      container,
      renderWindow,
      target: {
        key: anchor.key,
        offsetWithinMessage: anchor.offsetWithinMessage,
        index: safeAnchorIndex,
      },
      anchorTopBefore,
      missingDomErrorCode: 'prepend-anchor-after-missing',
      missingAnchorAfterPolicy: 'return',
    })
    const correction =
      correctionResult instanceof Promise ? await correctionResult : correctionResult

    if (correction.status === 'missing') {
      deps.emitError('prepend-anchor-after-missing')
      deps.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
        restoreBottomLockState: previousBottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      return
    }

    deps.setTransactionState('settling')
    deps.scrollIntent.setBottomLockState('UNLOCKED')
    deps.setViewportPhase('IDLE')
    deps.setTransactionState('idle')
    deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: 'READY',
      bottomLockState: 'UNLOCKED',
      viewportPhase: 'IDLE',
    })
    deps.emitViewportAnchorChanged('transaction-settle', anchor)
  } catch (error) {
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

export async function runWindowSlideTransaction<TMessage, TOptimistic>(
  deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  anchor: AnchorState,
  nextWindow: RenderWindow,
  expectedData: { feedId: string; generation: number; revision: number },
): Promise<void> {
  const data = deps.getDataSnapshot()
  const container = deps.registry.getContainer()

  if (!data || !container) {
    return
  }

  if (
    data.feedId !== expectedData.feedId ||
    data.generation !== expectedData.generation ||
    data.revision !== expectedData.revision
  ) {
    return
  }

  const anchorTopBefore = captureAnchorTop(deps, anchor.key)

  if (anchorTopBefore === null) {
    return
  }

  const anchorIndex = deps.renderWindow.findIndexByKey(data.items, anchor.key)

  if (anchorIndex < 0) {
    return
  }

  const token = deps.lifecycle.getCurrent()
  const previousSnapshot = deps.store.getSnapshot()
  const previousBottomLockState = deps.scrollIntent.getBottomLockState()
  const hasActiveFollowBottomIntent = deps.hasActiveFollowBottomIntent(data)

  deps.setTransactionState('active')
  deps.setViewportPhase('PROJECTING')

  try {
    if (hasActiveFollowBottomIntent && !data.hasMoreAfter) {
      const renderWindow = deps.renderWindow.computeLatestWindow(
        data.items,
        container.clientHeight,
        container.clientWidth,
      )
      const projection = deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: previousBottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await deps.commit.waitForChanged(projection, 'resize')
      deps.measureCurrentWindow()
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

    const projection = deps.projection.publish({
      data,
      renderWindow: nextWindow,
      bootstrapState: 'READY',
      bottomLockState: previousBottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await deps.commit.waitForChanged(projection, 'resize')
    const correction = correctPreservedAnchorAfterCommit(deps, {
      data,
      container,
      renderWindow: nextWindow,
      target: {
        key: anchor.key,
        offsetWithinMessage: anchor.offsetWithinMessage,
        index: anchorIndex,
      },
      anchorTopBefore,
      missingDomErrorCode: 'window-slide-anchor-after-missing',
      missingAnchorAfterPolicy: 'measure-only',
    })
    if (correction instanceof Promise) {
      await correction
    }

    deps.setViewportPhase('IDLE')
    deps.setTransactionState('idle')
    deps.projection.publish({
      data,
      renderWindow: nextWindow,
      bootstrapState: 'READY',
      bottomLockState: deps.scrollIntent.getBottomLockState(),
      viewportPhase: 'IDLE',
    })
    deps.emitViewportAnchorChanged('transaction-settle', anchor)
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

export function keepCurrentWindow<TMessage, TOptimistic>(
  deps: Pick<
    ViewportTransactionDeps<TMessage, TOptimistic>,
    'store' | 'renderWindow'
  >,
  items: Array<MessageDataItem<TMessage, TOptimistic>>,
): RenderWindow {
  const currentWindow = deps.store.getSnapshot().renderWindow
  return deps.renderWindow.computeWindowFromRange(
    items,
    currentWindow.startIndex,
    currentWindow.endIndex,
  )
}

export function createCommittedKey(messageId: string): MessageRuntimeItemKey {
  return { kind: 'committed', messageId }
}
