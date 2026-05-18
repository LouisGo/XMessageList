import type { AnchorCoordinator } from '../dom/anchorCoordinator'
import type { CommitCoordinator } from '../core/projection/commitCoordinator'
import type { DestinationMotionCoordinator } from '../scroll/destinationMotionCoordinator'
import type { DomRegistry } from '../dom/domRegistry'
import type { LifecycleGuard } from '../core/state/lifecycleGuard'
import type { MeasurementEngine } from '../dom/measurementEngine'
import type { ProjectionCoordinator } from '../core/projection/projectionCoordinator'
import type { ProjectionStore } from '../core/state/projectionStore'
import type { RenderWindowEngine } from '../window/renderWindowEngine'
import type { ScrollIntentEngine } from '../scroll/scrollIntentEngine'
import type {
  AnchorState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageRuntimeCommand,
  MessageViewportRuntimeEvent,
  MessageViewportSnapshot,
  RenderWindow,
  RuntimeState,
  ScrollSource,
  TransactionState,
  DestinationState,
  ViewportPhase,
  ViewportAnchorChangeReason,
} from '../types'
import type {
  CommitRecoveryInput,
  ContainerSize,
  DestinationMotionForcedStart,
  RuntimeDiagnosticEmitter,
} from '../core/state/runtimeTypes'
import { runBootstrapTransaction } from './bootstrapTransactions'
import {
  runPrependTransaction,
  runWindowSlideTransaction,
} from './anchorTransactions'
import {
  runJumpTransaction,
  runRestoreTransaction,
} from './destinationTransactions'
import { runFollowBottomTransaction } from './followBottomTransactions'

export type ViewportTransactionDeps<TMessage, TOptimistic> = {
  registry: DomRegistry
  store: ProjectionStore<TMessage, TOptimistic>
  lifecycle: LifecycleGuard
  renderWindow: RenderWindowEngine
  measurement: MeasurementEngine
  scrollIntent: ScrollIntentEngine
  projection: ProjectionCoordinator<TMessage, TOptimistic>
  commit: CommitCoordinator<TMessage, TOptimistic>
  anchor: AnchorCoordinator<TMessage, TOptimistic>
  motion: DestinationMotionCoordinator<TMessage, TOptimistic>
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  setState: (state: RuntimeState) => void
  setViewportPhase: (phase: ViewportPhase) => void
  setTransactionState: (state: TransactionState) => void
  setDestinationState: (state: DestinationState) => void
  setPendingBootstrap: (
    command: Extract<MessageRuntimeCommand, { type: 'bootstrap' }>,
  ) => void
  tryRunPendingBootstrap: () => boolean
  startPendingFollowBottom: (
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    commandId?: string,
  ) => void
  hasActiveFollowBottomIntent: (
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => boolean
  clearActiveFollowBottomIntent: (reason: string) => void
  reconcileBottomLockFromViewport: (
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    reason: string,
  ) => boolean
  keepCurrentWindow: (
    items: Array<MessageDataItem<TMessage, TOptimistic>>,
  ) => RenderWindow
  measureCurrentWindow: () => unknown[]
  waitForBootstrapSettle: (feedId: string, generation: number) => Promise<void>
  recoverAfterCommitFailure: (
    input: CommitRecoveryInput<TMessage, TOptimistic>,
  ) => void
  deriveRuntimeStateFromSnapshot: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => RuntimeState
  emitViewportAnchorChanged: (
    reason: ViewportAnchorChangeReason,
    anchor?: AnchorState | null,
  ) => void
  emitDestinationSettled: (event: {
    intent: 'jump'
    target: MessageIdentityAnchor
    resolution: 'target' | 'fallback-deleted'
    resolvedTarget?: MessageIdentityAnchor
  }) => void
  invalidateSpacerCache: () => void
  emitEvent: (event: MessageViewportRuntimeEvent) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
  emitError: (code: string) => void
}

export class ViewportTransactionController<TMessage, TOptimistic> {
  constructor(
    private readonly deps: ViewportTransactionDeps<TMessage, TOptimistic>,
  ) {}

  runBootstrapTransaction(
    mode: 'latest' | 'unread' | 'restored',
    target?: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): Promise<void> {
    return runBootstrapTransaction(this.deps, mode, target)
  }

  async runPrependTransaction(): Promise<void> {
    return runPrependTransaction(this.deps)
  }

  async runAppendTransaction(
    effect: 'append' | 'auto-scroll-to-bottom',
  ): Promise<void> {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    // BottomLocked 只代表 feed latest 的底部；hasMoreAfter=true 时，
    // 当前物理底部只是已加载 DataWindow 的 after edge，不能被 append page 追底。
    this.deps.reconcileBottomLockFromViewport(data, 'append-before-follow-check')
    const hasActiveFollowBottomIntent =
      this.deps.hasActiveFollowBottomIntent(data)
    const shouldFollow =
      !data.hasMoreAfter &&
      (effect === 'auto-scroll-to-bottom' ||
        this.deps.scrollIntent.getBottomLockState() === 'LOCKED' ||
        hasActiveFollowBottomIntent)
    const motionSource: Extract<ScrollSource, 'programmatic' | 'followBottom'> =
      hasActiveFollowBottomIntent ? 'followBottom' : 'programmatic'
    const token = this.deps.lifecycle.getCurrent()
    const renderWindow = shouldFollow
      ? this.deps.renderWindow.computeLatestWindow(
          data.items,
          container.clientHeight,
          container.clientWidth,
        )
      : this.deps.keepCurrentWindow(data.items)

    this.deps.setTransactionState('active')
    this.deps.setViewportPhase('PROJECTING')
    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
        viewportPhase: 'PROJECTING',
      })

      await this.deps.commit.waitForChanged(projection, 'append')
      this.deps.measureCurrentWindow()

      if (shouldFollow) {
        this.deps.setDestinationState('resolvingDom')
        this.deps.motion.start({
          source: motionSource,
          targetTop: this.deps.motion.getBottomTargetTop(container),
          data,
          renderWindow,
          bottomLockState: 'LOCKED',
        })
        this.deps.setTransactionState('idle')
        return
      }

      this.deps.setViewportPhase('IDLE')
      this.deps.setTransactionState('idle')
      this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
        viewportPhase: 'IDLE',
      })
      this.deps.emitViewportAnchorChanged('transaction-settle')
    } catch (error) {
      this.deps.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
      })
      this.deps.setTransactionState('idle')
      throw error
    }
  }

  async runProjectionRefreshTransaction(): Promise<void> {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    this.deps.reconcileBottomLockFromViewport(data, 'refresh-before-follow-check')
    const hasActiveFollowBottomIntent =
      this.deps.hasActiveFollowBottomIntent(data)
    const shouldFollowBottom =
      !data.hasMoreAfter &&
      (this.deps.scrollIntent.getBottomLockState() === 'LOCKED' ||
        hasActiveFollowBottomIntent)
    const snapshot = this.deps.store.getSnapshot()
    const renderWindow = shouldFollowBottom
      ? this.deps.renderWindow.computeLatestWindow(
          data.items,
          container.clientHeight,
          container.clientWidth,
        )
      : snapshot.renderWindow.endIndex >= snapshot.renderWindow.startIndex
        ? this.deps.keepCurrentWindow(data.items)
        : this.deps.renderWindow.computeLatestWindow(
            data.items,
            container.clientHeight,
            container.clientWidth,
          )

    if (shouldFollowBottom) {
      this.deps.setTransactionState('active')
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: snapshot.bootstrapState,
        bottomLockState: snapshot.bottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await this.deps.commit.waitForChanged(projection, 'resize')
      this.deps.measureCurrentWindow()

      if (hasActiveFollowBottomIntent) {
        this.deps.setDestinationState('resolvingDom')
        this.deps.motion.start({
          source: 'followBottom',
          targetTop: this.deps.motion.getBottomTargetTop(container),
          data,
          renderWindow,
          bottomLockState: 'LOCKED',
        })
        this.deps.setTransactionState('idle')
        return
      }

      this.deps.motion.scrollToBottom('programmatic')
      this.deps.scrollIntent.setBottomLockState('LOCKED')
      this.deps.setDestinationState('settled')
      this.deps.setViewportPhase('IDLE')
      this.deps.setTransactionState('idle')
      this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: snapshot.bootstrapState,
        bottomLockState: 'LOCKED',
        viewportPhase: 'IDLE',
      })
      this.deps.emitViewportAnchorChanged('transaction-settle')
      return
    }

    const anchor = this.deps.anchor.captureViewportAnchor()
    const anchorElementBefore = anchor
      ? this.deps.registry.getRow(anchor.key)
      : null
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top
    this.deps.setTransactionState('active')
    this.deps.setViewportPhase('PROJECTING')
    const projection = this.deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: snapshot.bootstrapState,
      bottomLockState: snapshot.bottomLockState,
      viewportPhase: 'PROJECTING',
    })

    await this.deps.commit.waitForChanged(projection, 'resize')

    let settledAnchor: AnchorState | null | undefined

    if (anchor && typeof anchorTopBefore === 'number') {
      // 普通 refresh 不改变用户正在看的 anchor；只在 commit 后 DOM 真正更新时补偿滚动。
      const anchorElementAfter = this.deps.registry.getRow(anchor.key)
      const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top
      this.deps.measureCurrentWindow()

      if (typeof anchorTopAfter === 'number') {
        const delta = anchorTopAfter - anchorTopBefore
        this.deps.setViewportPhase('CORRECTING')

        if (Math.abs(delta) > 0.5) {
          this.deps.motion.writeScrollTop(container.scrollTop + delta, 'recovery')
        }
        settledAnchor = anchor
      }
    } else {
      this.deps.measureCurrentWindow()
    }

    this.deps.setViewportPhase('IDLE')
    this.deps.projection.publish({
      data,
      renderWindow,
      bootstrapState: snapshot.bootstrapState,
      bottomLockState: this.deps.scrollIntent.getBottomLockState(),
      viewportPhase: 'IDLE',
    })
    this.deps.emitViewportAnchorChanged('transaction-settle', settledAnchor)
  }

  async runJumpTransaction(
    targetAnchor: MessageIdentityAnchor,
    options: {
      forceAnimateFrom?: DestinationMotionForcedStart
      allowPreposition?: boolean
      animate?: boolean
      originalTarget?: MessageIdentityAnchor
    } = {},
  ): Promise<void> {
    return runJumpTransaction(this.deps, targetAnchor, options)
  }

  async runRestoreTransaction(
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): Promise<void> {
    return runRestoreTransaction(this.deps, target)
  }

  async runFollowBottomTransaction(): Promise<void> {
    return runFollowBottomTransaction(this.deps)
  }

  async runWindowSlideTransaction(
    anchor: AnchorState,
    nextWindow: RenderWindow,
    expectedData: { feedId: string; generation: number; revision: number },
  ): Promise<void> {
    return runWindowSlideTransaction(this.deps, anchor, nextWindow, expectedData)
  }

  async runContainerResizeTransaction(
    previousSize: ContainerSize,
    nextSize: ContainerSize,
  ): Promise<void> {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()
    const previousSnapshot = this.deps.store.getSnapshot()
    const anchor = this.deps.anchor.captureViewportAnchor()
    const anchorElementBefore = anchor
      ? this.deps.registry.getRow(anchor.key)
      : null
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top
    const widthInvalidated = this.deps.measurement.invalidateForWidth(
      nextSize.width,
    )
    if (widthInvalidated) {
      this.deps.invalidateSpacerCache()
    }
    // 宽度变化会让文本换行和高度估算整体失效，必须先清 height cache 再计算新 window。
    const anchorIndex = anchor
      ? this.deps.renderWindow.findIndexByKey(data.items, anchor.key)
      : -1
    const hasActiveFollowBottomIntent =
      this.deps.hasActiveFollowBottomIntent(data)
    const shouldFollowBottom =
      !data.hasMoreAfter &&
      (previousBottomLockState === 'LOCKED' || hasActiveFollowBottomIntent)
    const renderWindow = shouldFollowBottom
      ? this.deps.renderWindow.computeLatestWindow(
          data.items,
          nextSize.height,
          nextSize.width,
        )
      : anchorIndex >= 0
        ? this.deps.renderWindow.computeWindowAroundAnchor({
            items: data.items,
            anchorIndex,
            viewportHeight: nextSize.height,
            viewportWidth: nextSize.width,
          })
        : this.deps.keepCurrentWindow(data.items)
    const sizeChanged =
      previousSize.width !== nextSize.width || previousSize.height !== nextSize.height
    const projectionNeeded =
      widthInvalidated ||
      sizeChanged ||
      !this.deps.projection.isRenderWindowEqual(
        previousSnapshot.renderWindow,
        renderWindow,
      )

    if (!projectionNeeded) {
      return
    }

    this.deps.setViewportPhase('PROJECTING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: previousSnapshot.bootstrapState,
        bottomLockState: previousBottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await this.deps.commit.waitForChanged(projection, 'resize')
      const anchorElementAfter =
        !shouldFollowBottom && anchor
          ? this.deps.registry.getRow(anchor.key)
          : null
      const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top
      this.deps.measureCurrentWindow()

      if (shouldFollowBottom) {
        if (hasActiveFollowBottomIntent) {
          this.deps.setDestinationState('resolvingDom')
          this.deps.motion.start({
            source: 'followBottom',
            targetTop: this.deps.motion.getBottomTargetTop(container),
            data,
            renderWindow,
            bottomLockState: 'LOCKED',
          })
          this.deps.setTransactionState('idle')
          return
        }

        this.deps.motion.scrollToBottom('programmatic')
        this.deps.scrollIntent.setBottomLockState('LOCKED')
        this.deps.setDestinationState('settled')
        this.deps.projection.publish({
          data,
          renderWindow,
          bootstrapState: previousSnapshot.bootstrapState,
          bottomLockState: 'LOCKED',
          viewportPhase: 'IDLE',
        })
      } else if (anchor && typeof anchorTopBefore === 'number') {
        if (typeof anchorTopAfter === 'number') {
          const delta = anchorTopAfter - anchorTopBefore
          this.deps.setTransactionState('settling')
          this.deps.setViewportPhase('CORRECTING')

          if (Math.abs(delta) > 0.5) {
            this.deps.motion.writeScrollTop(
              container.scrollTop + delta,
              'recovery',
            )
          }
        }
      }

      this.deps.setViewportPhase('IDLE')
      this.deps.setTransactionState('idle')
      this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: previousSnapshot.bootstrapState,
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
        viewportPhase: 'IDLE',
      })
      this.deps.emitViewportAnchorChanged(
        'transaction-settle',
        shouldFollowBottom ? undefined : (anchor ?? undefined),
      )
    } catch (error) {
      this.deps.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
        restoreBottomLockState: previousBottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      this.deps.setTransactionState('idle')
      throw error
    }
  }

  async runReset(reason: string): Promise<void> {
    this.deps.setPendingBootstrap({ type: 'bootstrap', mode: 'latest' })
    this.deps.tryRunPendingBootstrap()
    if (!this.deps.getDataSnapshot()) {
      this.deps.emitError(`reset-${reason}`)
    }
  }

}
