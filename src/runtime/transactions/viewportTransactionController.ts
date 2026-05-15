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
  MessageRuntimeCommand,
  MessageRuntimeItemKey,
  MessageViewportRuntimeEvent,
  MessageViewportSnapshot,
  RenderWindow,
  RuntimeState,
} from '../types'
import type {
  CommitRecoveryInput,
  ContainerSize,
} from '../core/runtimeTypes'
import { runBootstrapTransaction } from './bootstrapTransactions'

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
  setPendingBootstrap: (
    command: Extract<MessageRuntimeCommand, { type: 'bootstrap' }>,
  ) => void
  tryRunPendingBootstrap: () => boolean
  startPendingFollowBottom: (
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
  ) => void
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
    reason: 'scroll-idle' | 'transaction-settle',
  ) => void
  emitEvent: (event: MessageViewportRuntimeEvent) => void
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

    this.deps.setState('TRANSACTING')
    this.deps.scrollIntent.setBottomLockState('RECOVERING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'RECOVERING',
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

      if (Math.abs(delta) > 0.5) {
        this.deps.motion.writeScrollTop(container.scrollTop + delta, 'recovery')
      }

      this.deps.measureCurrentWindow()
      this.deps.scrollIntent.setBottomLockState('UNLOCKED')
      this.deps.setState('READY')
      this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'UNLOCKED',
      })
      this.deps.emitViewportAnchorChanged('transaction-settle')
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
    const shouldFollow =
      !data.hasMoreAfter &&
      (effect === 'auto-scroll-to-bottom' ||
        this.deps.scrollIntent.getBottomLockState() === 'LOCKED')
    const token = this.deps.lifecycle.getCurrent()
    const renderWindow = shouldFollow
      ? this.deps.renderWindow.computeLatestWindow(
          data.items,
          container.clientHeight,
          container.clientWidth,
        )
      : this.deps.keepCurrentWindow(data.items)

    this.deps.setState('TRANSACTING')
    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
      })

      await this.deps.commit.waitForChanged(projection, 'append')
      this.deps.measureCurrentWindow()

      if (shouldFollow) {
        this.deps.setState('READY')
        this.deps.motion.start({
          source: 'programmatic',
          targetTop: this.deps.motion.getBottomTargetTop(container),
          data,
          renderWindow,
          bottomLockState: 'LOCKED',
        })
        return
      }

      this.deps.setState('READY')
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

    const snapshot = this.deps.store.getSnapshot()
    const renderWindow =
      snapshot.renderWindow.endIndex >= snapshot.renderWindow.startIndex
        ? this.deps.keepCurrentWindow(data.items)
        : this.deps.renderWindow.computeLatestWindow(
            data.items,
            container.clientHeight,
            container.clientWidth,
          )

    if (
      this.deps.scrollIntent.getBottomLockState() === 'LOCKED' &&
      !data.hasMoreAfter
    ) {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: snapshot.bootstrapState,
        bottomLockState: snapshot.bottomLockState,
      })

      await this.deps.commit.waitForChanged(projection, 'resize')
      this.deps.measureCurrentWindow()
      this.deps.motion.scrollToBottom('programmatic')
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
    })

    await this.deps.commit.waitForChanged(projection, 'resize')

    if (anchor && typeof anchorTopBefore === 'number') {
      // 普通 refresh 不改变用户正在看的 anchor；只在 commit 后 DOM 真正更新时补偿滚动。
      const anchorElementAfter = this.deps.registry.getRow(anchor.key)
      const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

      if (typeof anchorTopAfter === 'number') {
        const delta = anchorTopAfter - anchorTopBefore

        if (Math.abs(delta) > 0.5) {
          this.deps.motion.writeScrollTop(container.scrollTop + delta, 'recovery')
        }
      }
    }

    this.deps.measureCurrentWindow()
    this.deps.emitViewportAnchorChanged('transaction-settle')
  }

  async runJumpTransaction(messageId: string): Promise<void> {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const targetIndex = data.items.findIndex(
      (item) =>
        item.key.kind === 'committed' && item.key.messageId === messageId,
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

    this.deps.setState('TRANSACTING')
    this.deps.scrollIntent.setBottomLockState('RECOVERING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'RECOVERING',
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

      this.deps.setState('READY')
      this.deps.motion.start({
        source: 'jump',
        targetTop: container.scrollTop + centerDelta,
        data,
        renderWindow,
        bottomLockState: 'UNLOCKED',
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

    this.deps.setState('TRANSACTING')
    this.deps.scrollIntent.setBottomLockState('RECOVERING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'RECOVERING',
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

      this.deps.anchor.alignToResolvedRestoreTarget(
        container,
        restoreTarget,
        resolvedRestoreTarget,
      )
      this.deps.measureCurrentWindow()
      this.deps.scrollIntent.setBottomLockState('UNLOCKED')
      this.deps.setState('READY')
      this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'UNLOCKED',
      })
      this.deps.emitViewportAnchorChanged('transaction-settle')
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

    if (data.hasMoreAfter) {
      // followBottom 的目标是会话最新消息；当前 DataWindow 还缺 newer page 时，
      // runtime 只能表达分页需求，不能把 partial bottom 锁成 BottomAnchor。
      this.deps.startPendingFollowBottom(data, container.scrollTop)
      return
    }

    const renderWindow = this.deps.renderWindow.computeLatestWindow(
      data.items,
      container.clientHeight,
      container.clientWidth,
    )
    const token = this.deps.lifecycle.getCurrent()
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()

    this.deps.setState('TRANSACTING')
    // follow-bottom 必须先切到 latest projection，再基于 commit 后的真实 DOM 吸底；
    // 如果先写 scrollTop，旧窗口 bottom spacer 的估算误差会把最终位置留在底部上方。
    this.deps.scrollIntent.setBottomLockState('RECOVERING')
    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'RECOVERING',
      })

      await this.deps.commit.waitForChanged(projection, 'followBottom')
      this.deps.measureCurrentWindow()
      this.deps.setState('READY')
      this.deps.motion.start({
        source: 'followBottom',
        targetTop: this.deps.motion.getBottomTargetTop(container),
        data,
        renderWindow,
        bottomLockState: 'LOCKED',
      })
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
        },
      })
      throw error
    }
  }

  async runWindowSlideTransaction(
    anchorKey: MessageRuntimeItemKey,
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

    const anchorElementBefore = this.deps.registry.getRow(anchorKey)
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top

    if (typeof anchorTopBefore !== 'number') {
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    const previousSnapshot = this.deps.store.getSnapshot()
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()

    this.deps.setState('TRANSACTING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow: nextWindow,
        bootstrapState: 'READY',
        bottomLockState: previousBottomLockState,
      })

      await this.deps.commit.waitForChanged(projection, 'resize')

      const anchorElementAfter = this.deps.registry.getRow(anchorKey)
      const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

      if (typeof anchorTopAfter === 'number') {
        const delta = anchorTopAfter - anchorTopBefore

        if (Math.abs(delta) > 0.5) {
          this.deps.motion.writeScrollTop(container.scrollTop + delta, 'recovery')
        }
      }

      this.deps.measureCurrentWindow()
      this.deps.setState('READY')
      this.deps.emitViewportAnchorChanged('transaction-settle')
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
    // 宽度变化会让文本换行和高度估算整体失效，必须先清 height cache 再计算新 window。
    const anchorIndex = anchor
      ? this.deps.renderWindow.findIndexByKey(data.items, anchor.key)
      : -1
    const shouldFollowBottom =
      previousBottomLockState === 'LOCKED' && !data.hasMoreAfter
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

    this.deps.setState('TRANSACTING')

    try {
      const projection = this.deps.projection.publish({
        data,
        renderWindow,
        bootstrapState: previousSnapshot.bootstrapState,
        bottomLockState: previousBottomLockState,
      })

      await this.deps.commit.waitForChanged(projection, 'resize')
      this.deps.measureCurrentWindow()

      if (shouldFollowBottom) {
        this.deps.motion.scrollToBottom('programmatic')
        this.deps.scrollIntent.setBottomLockState('LOCKED')
        this.deps.projection.publish({
          data,
          renderWindow,
          bootstrapState: previousSnapshot.bootstrapState,
          bottomLockState: 'LOCKED',
        })
      } else if (anchor && typeof anchorTopBefore === 'number') {
        const anchorElementAfter = this.deps.registry.getRow(anchor.key)
        const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

        if (typeof anchorTopAfter === 'number') {
          const delta = anchorTopAfter - anchorTopBefore

          if (Math.abs(delta) > 0.5) {
            this.deps.motion.writeScrollTop(
              container.scrollTop + delta,
              'recovery',
            )
          }
        }
      }

      this.deps.setState('READY')
      this.deps.emitViewportAnchorChanged('transaction-settle')
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
}
