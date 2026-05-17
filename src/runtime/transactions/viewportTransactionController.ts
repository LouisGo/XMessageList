import type { AnchorCoordinator } from '../dom/anchorCoordinator'
import type { CommitCoordinator } from '../core/commitCoordinator'
import type { DestinationMotionCoordinator } from '../scroll/destinationMotionCoordinator'
import type { DomRegistry } from '../dom/domRegistry'
import type { LifecycleGuard } from '../core/lifecycleGuard'
import type { MeasurementEngine } from '../dom/measurementEngine'
import type { ProjectionCoordinator } from '../core/projectionCoordinator'
import type { ProjectionStore } from '../core/projectionStore'
import type { RenderWindowEngine } from '../window/renderWindowEngine'
import type { ScrollIntentEngine } from '../scroll/scrollIntentEngine'
import type {
  AnchorState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageRuntimeCommand,
  MessageRuntimeItemKey,
  MessageViewportRuntimeEvent,
  MessageViewportSnapshot,
  RenderWindow,
  RuntimeState,
  ScrollSource,
  ViewportPhase,
  ViewportAnchorChangeReason,
} from '../types'
import type {
  CommitRecoveryInput,
  ContainerSize,
  DestinationMotionForcedStart,
  MeasurableRow,
  RuntimeDiagnosticEmitter,
  RestoreTarget,
} from '../core/runtimeTypes'
import { runBootstrapTransaction } from './bootstrapTransactions'
import { areRuntimeItemKeysEqual } from '../shared/utils'

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
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const anchor = this.deps.anchor.captureViewportAnchor()

    if (!anchor) {
      this.deps.emitError('prepend-anchor-missing')
      return
    }

    // prepend 以当前 viewport anchor 的 DOM top 为基准；新历史插入后用前后差值抵消位移。
    const anchorElementBefore = this.deps.registry.getRow(anchor.key)
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top

    if (typeof anchorTopBefore !== 'number') {
      this.deps.emitError('prepend-anchor-dom-missing')
      return
    }

    const anchorIndex = this.deps.renderWindow.findIndexByKey(
      data.items,
      anchor.key,
    )
    const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : 0
    const token = this.deps.lifecycle.getCurrent()
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()
    const previousSnapshot = this.deps.store.getSnapshot()
    const renderWindow = this.deps.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex: safeAnchorIndex,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })

    // transaction 只进入 projection/correction 视觉阶段，不改变 lifecycle，
    // 也不覆盖业务 bottom lock；prepend 完成前用户仍处于原阅读语义。
    this.deps.setViewportPhase('PROJECTING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: previousBottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await this.deps.commit.waitForChanged(projection, 'prepend')

      const anchorElementAfter = this.deps.registry.getRow(anchor.key)
      const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

      if (typeof anchorTopAfter !== 'number') {
        this.deps.emitError('prepend-anchor-after-missing')
        this.deps.recoverAfterCommitFailure({
          token,
          nextState: 'READY',
          restoreBottomLockState: previousBottomLockState,
          restoreSnapshot: previousSnapshot,
        })
        return
      }

      const delta = anchorTopAfter - anchorTopBefore
      this.deps.measureCurrentWindow()
      this.deps.setViewportPhase('CORRECTING')

      if (Math.abs(delta) > 0.5) {
        this.deps.motion.writeScrollTop(container.scrollTop + delta, 'recovery')
      }

      this.deps.scrollIntent.setBottomLockState('UNLOCKED')
      this.deps.setViewportPhase('IDLE')
      this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'UNLOCKED',
        viewportPhase: 'IDLE',
      })
      this.deps.emitViewportAnchorChanged('transaction-settle', anchor)
    } catch (error) {
      this.deps.recoverAfterCommitFailure({
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
      throw error
    }
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
        this.deps.motion.start({
          source: motionSource,
          targetTop: this.deps.motion.getBottomTargetTop(container),
          data,
          renderWindow,
          bottomLockState: 'LOCKED',
        })
        return
      }

      this.deps.setViewportPhase('IDLE')
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
        this.deps.motion.start({
          source: 'followBottom',
          targetTop: this.deps.motion.getBottomTargetTop(container),
          data,
          renderWindow,
          bottomLockState: 'LOCKED',
        })
        return
      }

      this.deps.motion.scrollToBottom('programmatic')
      this.deps.scrollIntent.setBottomLockState('LOCKED')
      this.deps.setViewportPhase('IDLE')
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
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const messageId = targetAnchor.messageId
    const targetIndex = this.deps.renderWindow.findCommittedMessageIndex(
      data.items,
      messageId,
    )

    if (targetIndex < 0) {
      this.deps.emitError('jump-target-missing')
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()
    const previousSnapshot = this.deps.store.getSnapshot()
    const targetKey: MessageRuntimeItemKey = { kind: 'committed', messageId }
    const renderWindow = this.deps.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex: targetIndex,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })

    // jump 的 projection 阶段只是在准备目标 DOM；目的地完成由 motion settle 表达。
    this.deps.setViewportPhase('PROJECTING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: previousBottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await this.deps.commit.waitForChanged(projection, 'jump')
      const target =
        this.deps.anchor.getDirectMeasurableRow(targetKey) ??
        (await this.deps.anchor.resolveMeasurableRowForTarget({
          data,
          targetKey,
          targetIndex,
          renderWindow,
          missingDomErrorCode: 'jump-target-dom-missing',
        }))

      if (!target) {
        this.deps.recoverAfterCommitFailure({
          token,
          nextState: 'READY',
          restoreBottomLockState: previousBottomLockState,
          restoreSnapshot: previousSnapshot,
        })
        return
      }

      const containerRect = container.getBoundingClientRect()
      const targetRect = target.element.getBoundingClientRect()
      // jump 是显式导航，目标放在 viewport 中心比复用原 offset 更符合定位语义。
      const centerDelta =
        targetRect.top -
        containerRect.top -
        Math.max(0, (container.clientHeight - targetRect.height) / 2)

      const targetTop = container.scrollTop + centerDelta

      if (options.animate === false) {
        this.deps.motion.scrollTo('jump', targetTop)
        this.deps.scrollIntent.setBottomLockState('UNLOCKED')
        this.deps.setViewportPhase('IDLE')
        this.deps.projection.publish({
          data,
          renderWindow,
          bootstrapState: this.deps.store.getSnapshot().bootstrapState,
          bottomLockState: 'UNLOCKED',
          viewportPhase: 'IDLE',
        })
        this.deps.emitDestinationSettled({
          intent: 'jump',
          target: options.originalTarget ?? targetAnchor,
          resolution: getJumpResolution(options.originalTarget, targetAnchor),
          resolvedTarget: targetAnchor,
        })
        this.deps.emitViewportAnchorChanged('transaction-settle')
        return
      }

      this.deps.motion.start({
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
    } catch (error) {
      this.deps.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
        restoreBottomLockState: previousBottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      throw error
    }
  }

  async runRestoreTransaction(
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): Promise<void> {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const restoreTarget = this.deps.anchor.resolveRestoreTarget(data, target)

    if (!restoreTarget) {
      this.deps.emitError('restore-target-missing')
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()
    const previousSnapshot = this.deps.store.getSnapshot()
    const renderWindow = this.deps.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex: restoreTarget.index,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })

    // restore 是视觉恢复事务：projection/measurement/correction 由 viewportPhase 表达，
    // bottom lock 保留原值直到最终按落点重新 reconcile。
    this.deps.setViewportPhase('PROJECTING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: previousBottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await this.deps.commit.waitForChanged(projection, 'restore')

      const resolvedRestoreTarget =
        this.deps.anchor.getDirectMeasurableRow(restoreTarget.key) ??
        (await this.deps.anchor.resolveMeasurableRowForTarget({
          data,
          targetKey: restoreTarget.key,
          targetIndex: restoreTarget.index,
          renderWindow,
          missingDomErrorCode: 'restore-target-dom-missing',
        }))

      if (!resolvedRestoreTarget) {
        this.deps.recoverAfterCommitFailure({
          token,
          nextState: 'READY',
          restoreBottomLockState: previousBottomLockState,
          restoreSnapshot: previousSnapshot,
        })
        return
      }

      this.deps.measureCurrentWindow()
      this.deps.setViewportPhase('CORRECTING')
      this.deps.anchor.alignToResolvedRestoreTarget(
        container,
        restoreTarget,
        resolvedRestoreTarget,
      )
      this.deps.scrollIntent.setBottomLockState('UNLOCKED')
      this.deps.reconcileBottomLockFromViewport(data, 'restore-settle')
      this.deps.setViewportPhase('IDLE')
      this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
        viewportPhase: 'IDLE',
      })
      this.deps.emitViewportAnchorChanged(
        'transaction-settle',
        this.createSettledRestoreAnchor(restoreTarget, resolvedRestoreTarget),
      )
    } catch (error) {
      this.deps.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
        restoreBottomLockState: previousBottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      throw error
    }
  }

  async runFollowBottomTransaction(): Promise<void> {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const dataCorrelationId =
      `data:${data.feedId}:${data.generation}:${data.revision}`
    this.deps.emitDiagnostic({
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
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
      }),
    })

    if (data.hasMoreAfter) {
      // followBottom 的目标是会话最新消息；当前 DataWindow 还缺 latest window 时，
      // runtime 只能请求 latest window，不能把 partial bottom 锁成 BottomAnchor。
      this.deps.emitDiagnostic({
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
      this.deps.startPendingFollowBottom(data, container.scrollTop)
      return
    }

    const renderWindow = this.deps.renderWindow.computeLatestWindow(
      data.items,
      container.clientHeight,
      container.clientWidth,
    )
    const preProjectionScrollTop = container.scrollTop
    const token = this.deps.lifecycle.getCurrent()
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()

    this.deps.setViewportPhase('PROJECTING')
    // follow-bottom 必须先切到 latest projection，再基于 commit 后的真实 DOM 吸底；
    // 如果先写 scrollTop，旧窗口 bottom spacer 的估算误差会把最终位置留在底部上方。
    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: previousBottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await this.deps.commit.waitForChanged(projection, 'followBottom')
      this.deps.measureCurrentWindow()
      const targetTop = this.deps.motion.getBottomTargetTop(container)
      const forceAnimateFrom =
        Math.abs(targetTop - container.scrollTop) <= 1 &&
        preProjectionScrollTop > targetTop + 1
          ? 'beforeTarget' as const
          : undefined
      this.deps.emitDiagnostic({
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
      this.deps.motion.start({
        source: 'followBottom',
        targetTop,
        data,
        renderWindow,
        bottomLockState: 'LOCKED',
        forceAnimateFrom,
      })
    } catch (error) {
      this.deps.clearActiveFollowBottomIntent('commit-timeout')
      this.deps.recoverAfterCommitFailure({
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
      throw error
    }
  }

  async runWindowSlideTransaction(
    anchor: AnchorState,
    nextWindow: RenderWindow,
    expectedData: { feedId: string; generation: number; revision: number },
  ): Promise<void> {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    // window slide 是滚动派生计划；如果数据窗口已经变化，旧计划必须丢弃，
    // 否则会用旧 index 套到 prepend 后的新数据上，造成阅读 anchor 跳动。
    if (
      data.feedId !== expectedData.feedId ||
      data.generation !== expectedData.generation ||
      data.revision !== expectedData.revision
    ) {
      return
    }

    const anchorElementBefore = this.deps.registry.getRow(anchor.key)
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top

    if (typeof anchorTopBefore !== 'number') {
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    const previousSnapshot = this.deps.store.getSnapshot()
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()
    const hasActiveFollowBottomIntent =
      this.deps.hasActiveFollowBottomIntent(data)

    this.deps.setViewportPhase('PROJECTING')

    try {
      if (hasActiveFollowBottomIntent && !data.hasMoreAfter) {
        const renderWindow = this.deps.renderWindow.computeLatestWindow(
          data.items,
          container.clientHeight,
          container.clientWidth,
        )
        const projection = this.deps.projection.publish({
          data,
          renderWindow,
          bootstrapState: 'READY',
          bottomLockState: previousBottomLockState,
          viewportPhase: 'PROJECTING',
        })

        await this.deps.commit.waitForChanged(projection, 'resize')
        this.deps.measureCurrentWindow()
        this.deps.motion.start({
          source: 'followBottom',
          targetTop: this.deps.motion.getBottomTargetTop(container),
          data,
          renderWindow,
          bottomLockState: 'LOCKED',
        })
        return
      }

      const projection = this.deps.projection.publish({
        data,
        renderWindow: nextWindow,
        bootstrapState: 'READY',
        bottomLockState: previousBottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await this.deps.commit.waitForChanged(projection, 'resize')

      const anchorElementAfter = this.deps.registry.getRow(anchor.key)
      const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

      if (typeof anchorTopAfter === 'number') {
        const delta = anchorTopAfter - anchorTopBefore
        this.deps.measureCurrentWindow()
        this.deps.setViewportPhase('CORRECTING')

        if (Math.abs(delta) > 0.5) {
          this.deps.motion.writeScrollTop(container.scrollTop + delta, 'recovery')
        }
      } else {
        this.deps.measureCurrentWindow()
      }

      this.deps.setViewportPhase('IDLE')
      this.deps.projection.publish({
        data,
        renderWindow: nextWindow,
        bootstrapState: 'READY',
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
        viewportPhase: 'IDLE',
      })
      this.deps.emitViewportAnchorChanged('transaction-settle', anchor)
    } catch (error) {
      this.deps.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
        restoreBottomLockState: previousBottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      throw error
    }
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
          this.deps.motion.start({
            source: 'followBottom',
            targetTop: this.deps.motion.getBottomTargetTop(container),
            data,
            renderWindow,
            bottomLockState: 'LOCKED',
          })
          return
        } else {
          this.deps.motion.scrollToBottom('programmatic')
          this.deps.scrollIntent.setBottomLockState('LOCKED')
          this.deps.projection.publish({
            data,
            renderWindow,
            bootstrapState: previousSnapshot.bootstrapState,
            bottomLockState: 'LOCKED',
            viewportPhase: 'IDLE',
          })
        }
      } else if (anchor && typeof anchorTopBefore === 'number') {
        if (typeof anchorTopAfter === 'number') {
          const delta = anchorTopAfter - anchorTopBefore
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

  private createSettledRestoreAnchor(
    target: RestoreTarget,
    resolved: MeasurableRow,
  ): AnchorState {
    return {
      key: resolved.key,
      offsetWithinMessage: areRuntimeItemKeysEqual(resolved.key, target.key)
        ? target.offsetWithinMessage
        : 0,
    }
  }
}

function getJumpResolution(
  originalTarget: MessageIdentityAnchor | undefined,
  resolvedTarget: MessageIdentityAnchor,
): 'target' | 'fallback-deleted' {
  if (!originalTarget || originalTarget.messageId === resolvedTarget.messageId) {
    return 'target'
  }

  return 'fallback-deleted'
}
