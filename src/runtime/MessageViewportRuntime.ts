import { DomRegistry } from './domRegistry'
import { LifecycleGuard } from './lifecycleGuard'
import { MeasurementEngine, type HeightDelta } from './measurementEngine'
import { ProjectionStore, createEmptySnapshot } from './projectionStore'
import { RenderWindowEngine } from './renderWindowEngine'
import { ScrollIntentEngine } from './scrollIntentEngine'
import { SpacerEngine, type HeightCache } from './spacerEngine'
import { TransactionRunner } from './transactionRunner'
import type {
  AnchorState,
  BootstrapState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageRuntimeCommand,
  MessageRuntimeItemKey,
  MessageViewportRuntimeEvent,
  MessageViewportRuntimeOptions,
  MessageViewportSnapshot,
  ProjectionCommit,
  RenderWindow,
  RuntimeEventListener,
  RuntimeListener,
  RuntimeObserverFactory,
  RuntimeScheduler,
  RuntimeState,
  ScrollSource,
  ViewportEdgeState,
  ViewportTransactionKind,
  WindowConfig,
} from './types'
import {
  DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
  DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
  areRuntimeItemKeysEqual,
  createDefaultObserverFactory,
  createDefaultScheduler,
  getDistanceToBottom,
  getRuntimeItemKey,
  mergeWindowConfig,
} from './utils'

type PendingCommit = {
  feedId: string
  generation: number
  revision: number
  transactionKind: ViewportTransactionKind
  timeoutId: number
  resolve: () => void
  reject: (error: Error) => void
}

type PublishResult<TMessage, TOptimistic> = {
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
  changed: boolean
}

const BOOTSTRAP_STABLE_FRAMES = 2
const BOOTSTRAP_HEIGHT_EPSILON_PX = 1
const BOOTSTRAP_SETTLE_TIMEOUT_MS = 300
const DEFAULT_EDGE_LOAD_THRESHOLD_PX = 96

/**
 * MessageViewportRuntime 是独立于 React 的 IM viewport engine。
 * 它拥有滚动语义、DOM 测量、anchor 稳定和 transaction；React 只能订阅 projection。
 */
export class MessageViewportRuntime<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  private readonly config: WindowConfig

  private readonly scheduler: RuntimeScheduler

  private readonly observerFactory: RuntimeObserverFactory

  private readonly heightCache: HeightCache = new Map()

  private readonly store: ProjectionStore<TMessage, TOptimistic>

  private readonly registry = new DomRegistry()

  private readonly lifecycle: LifecycleGuard

  private readonly spacer: SpacerEngine

  private readonly renderWindow: RenderWindowEngine

  private readonly measurement: MeasurementEngine

  private readonly scrollIntent: ScrollIntentEngine

  private readonly transactions = new TransactionRunner()

  private readonly eventListeners = new Set<RuntimeEventListener>()

  private readonly commitTimeoutMs: Required<
    NonNullable<MessageViewportRuntimeOptions['commitTimeoutMs']>
  >

  private readonly edgeLoadThresholdPx: number

  private state: RuntimeState = 'INITIAL'

  private dataSnapshot: MessageDataSnapshot<TMessage, TOptimistic> | null = null

  private pendingBootstrap: Extract<MessageRuntimeCommand, { type: 'bootstrap' }> | null =
    null

  private pendingCommit: PendingCommit | null = null

  private scrollRaf: number | null = null

  private stabilizationRaf: number | null = null

  private resizeRaf: number | null = null

  private currentFrame = 0

  private beforeEdgeRequestLatched = false

  private afterEdgeRequestLatched = false

  private lastScrollSource: ScrollSource | null = null

  private lastUserScrollTop = 0

  private lastUserDistanceToBottom = 0

  private containerResizeObserver: ResizeObserver | null = null

  private intersectionObserver: IntersectionObserver | null = null

  private readonly handleScroll = (): void => {
    this.scheduleScrollRaf()
  }

  constructor(options: MessageViewportRuntimeOptions = {}) {
    const feedId = options.feedId ?? ''
    const generation = options.generation ?? 0
    const defaultObservers = createDefaultObserverFactory()

    this.config = mergeWindowConfig(options.window)
    this.scheduler = options.scheduler ?? createDefaultScheduler()
    this.observerFactory = {
      createResizeObserver:
        options.observers?.createResizeObserver ??
        defaultObservers.createResizeObserver,
      createIntersectionObserver:
        options.observers?.createIntersectionObserver ??
        defaultObservers.createIntersectionObserver,
    }
    this.commitTimeoutMs = {
      bootstrap: options.commitTimeoutMs?.bootstrap ?? 1000,
      normal: options.commitTimeoutMs?.normal ?? 500,
      jump: options.commitTimeoutMs?.jump ?? 800,
    }
    this.edgeLoadThresholdPx =
      options.edgeLoadThresholdPx ?? DEFAULT_EDGE_LOAD_THRESHOLD_PX

    this.store = new ProjectionStore(
      createEmptySnapshot<TMessage, TOptimistic>(feedId, generation),
    )
    this.lifecycle = new LifecycleGuard(feedId, generation)
    this.spacer = new SpacerEngine(this.config, this.heightCache)
    this.renderWindow = new RenderWindowEngine(this.config, this.spacer)
    this.measurement = new MeasurementEngine(
      this.heightCache,
      this.observerFactory,
      () => this.scheduleHeightStabilization(),
    )
    this.scrollIntent = new ScrollIntentEngine(
      options.bottomLockThresholdPx ?? DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
      options.bottomUnlockThresholdPx ?? DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
    )
  }

  attach(container: HTMLElement): void {
    if (this.state === 'DESTROYED') {
      return
    }

    const current = this.registry.getContainer()

    if (current === container) {
      return
    }

    if (current) {
      this.detach()
    }

    this.lifecycle.resume()
    this.transactions.resume()
    this.registry.attachContainer(container)
    container.addEventListener('scroll', this.handleScroll, { passive: true })
    this.setupContainerObserver(container)
    this.setupIntersectionObserver(container)
    this.state =
      this.store.getSnapshot().bootstrapState === 'READY' ? 'READY' : 'ATTACHED'
    this.tryRunPendingBootstrap()
  }

  detach(): void {
    if (this.state === 'DESTROYED') {
      return
    }

    const container = this.registry.getContainer()

    this.lifecycle.suspend()
    this.cancelPendingCommit()
    this.cancelScheduledWork()
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver = null
    this.intersectionObserver?.disconnect()
    this.intersectionObserver = null
    this.measurement.disconnect()
    this.transactions.clear()

    if (container) {
      container.removeEventListener('scroll', this.handleScroll)
    }

    this.registry.clearDomRefs()
    this.state = 'DETACHED'
  }

  destroy(): void {
    if (this.state === 'DESTROYED') {
      return
    }

    this.detach()
    this.lifecycle.destroy()
    this.transactions.stop()
    this.heightCache.clear()
    this.eventListeners.clear()
    this.store.clearListeners()
    this.state = 'DESTROYED'
  }

  setDataSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): void {
    if (this.state === 'DESTROYED') {
      return
    }

    const previous = this.dataSnapshot
    const generationChanged =
      previous?.feedId !== snapshot.feedId ||
      previous?.generation !== snapshot.generation

    if (generationChanged) {
      this.resetForGeneration(snapshot.feedId, snapshot.generation)
    }

    this.dataSnapshot = snapshot

    if (snapshot.hasMoreAfter && this.scrollIntent.getBottomLockState() === 'LOCKED') {
      this.scrollIntent.setBottomLockState('UNLOCKED')
    }

    if (snapshot.change.viewportEffect !== 'none') {
      this.transactions.dropBySupersedeKey('window-slide')
    }

    if (this.tryRunPendingBootstrap()) {
      return
    }

    if (this.state === 'INITIAL' || this.state === 'ATTACHED') {
      return
    }

    switch (snapshot.change.viewportEffect) {
      case 'prepend':
        this.enqueuePrependTransaction()
        break
      case 'append':
      case 'auto-scroll-to-bottom':
        this.enqueueAppendTransaction(snapshot.change.viewportEffect)
        break
      case 'reset':
        this.dispatch({ type: 'reset', reason: 'data-reset' })
        break
      default:
        this.enqueueProjectionRefresh()
        break
    }
  }

  dispatch(command: MessageRuntimeCommand): void {
    if (this.state === 'DESTROYED') {
      return
    }

    switch (command.type) {
      case 'bootstrap':
        this.pendingBootstrap = command
        this.tryRunPendingBootstrap()
        break
      case 'followBottom':
        this.enqueueFollowBottomTransaction()
        break
      case 'jump':
        this.enqueueJumpTransaction(command.target.messageId)
        break
      case 'restore':
        this.enqueueRestoreTransaction(command.target)
        break
      case 'reset':
        this.enqueueResetTransaction(command.reason)
        break
    }
  }

  subscribe(listener: RuntimeListener): () => void {
    return this.store.subscribe(listener)
  }

  subscribeEvent(listener: RuntimeEventListener): () => void {
    this.eventListeners.add(listener)

    return () => {
      this.eventListeners.delete(listener)
    }
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.store.getSnapshot()
  }

  getViewportAnchorState(): AnchorState | null {
    const anchor = this.captureViewportAnchor()
    return anchor ? cloneAnchorState(anchor) : null
  }

  registerRow(key: MessageRuntimeItemKey, element: HTMLElement | null): void {
    const previous = this.registry.registerRow(key, element)

    if (previous && previous !== element) {
      this.measurement.unobserveRow(previous)
    }

    this.measurement.observeRow(key, element)
  }

  registerTopSpacer(element: HTMLElement | null): void {
    this.registry.registerTopSpacer(element)
  }

  registerBottomSpacer(element: HTMLElement | null): void {
    this.registry.registerBottomSpacer(element)
  }

  registerTopSentinel(element: HTMLElement | null): void {
    this.registry.registerTopSentinel(element)
    this.observeSentinels()
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    this.registry.registerBottomSentinel(element)
    this.observeSentinels()
  }

  notifyProjectionCommitted(commit: ProjectionCommit): void {
    const pending = this.pendingCommit

    if (
      !pending ||
      pending.feedId !== commit.feedId ||
      pending.generation !== commit.generation ||
      pending.revision !== commit.revision
    ) {
      return
    }

    this.scheduler.clearTimeout(pending.timeoutId)
    this.pendingCommit = null
    pending.resolve()
  }

  getDebugSnapshot(): {
    state: RuntimeState
    pendingCommands: number
    observedRows: number
    heightCacheSize: number
  } {
    return {
      state: this.state,
      pendingCommands: this.transactions.getPendingCount(),
      observedRows: this.registry.getSnapshot().observedRows,
      heightCacheSize: this.heightCache.size,
    }
  }

  private tryRunPendingBootstrap(): boolean {
    if (!this.pendingBootstrap || !this.dataSnapshot || !this.registry.getContainer()) {
      return false
    }

    const command = this.pendingBootstrap
    this.pendingBootstrap = null
    this.transactions.enqueue(
      'bootstrap',
      () => this.runBootstrapTransaction(command.mode, command.target),
      'bootstrap',
    )
    return true
  }

  private resetForGeneration(feedId: string, generation: number): void {
    this.lifecycle.reset(feedId, generation)
    this.transactions.clear()
    this.cancelPendingCommit()
    this.cancelScheduledWork()
    this.heightCache.clear()
    this.beforeEdgeRequestLatched = false
    this.afterEdgeRequestLatched = false
    this.lastScrollSource = null
    this.scrollIntent.setBottomLockState('UNLOCKED')
    this.store.setSnapshot(createEmptySnapshot<TMessage, TOptimistic>(feedId, generation))
    this.state = this.registry.getContainer() ? 'ATTACHED' : 'INITIAL'
  }

  private async runBootstrapTransaction(
    mode: 'latest' | 'unread' | 'restored',
    target?: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): Promise<void> {
    if (!this.dataSnapshot || !this.registry.getContainer()) {
      return
    }

    const data = this.dataSnapshot
    const container = this.registry.getContainer() as HTMLElement
    const token = this.lifecycle.getCurrent()
    const previousSnapshot = this.store.getSnapshot()

    if (data.items.length === 0) {
      this.publishProjection({
        data,
        renderWindow: this.renderWindow.computeLatestWindow(
          data.items,
          container.clientHeight,
          container.clientWidth,
        ),
        topSpacer: 0,
        bottomSpacer: 0,
        bootstrapState: 'READY_EMPTY',
        bottomLockState: 'LOCKED',
      })
      this.state = 'READY'
      this.emitEvent({ type: 'viewportReady', feedId: data.feedId, generation: data.generation })
      return
    }

    if (mode === 'latest') {
      const renderWindow = this.renderWindow.computeLatestWindow(
        data.items,
        container.clientHeight,
        container.clientWidth,
      )

      this.state = 'BOOTSTRAPPING'

      try {
        const projection = this.publishProjection({
          data,
          renderWindow,
          bootstrapState: 'MOUNTING',
          bottomLockState: 'UNLOCKED',
        })

        await this.waitForCommitIfChanged(projection, 'bootstrap')
        this.measureCurrentWindow()
        this.scrollToBottom('followBottom')
        await this.waitForBootstrapSettle(data.feedId, data.generation)
        this.measureCurrentWindow()
        this.scrollToBottom('followBottom')
        this.scrollIntent.setBottomLockState('LOCKED')
        this.state = 'READY'
        this.publishProjection({
          data,
          renderWindow,
          bootstrapState: 'READY',
          bottomLockState: 'LOCKED',
        })
        this.emitEvent({
          type: 'viewportReady',
          feedId: data.feedId,
          generation: data.generation,
        })
      } catch (error) {
        this.recoverAfterCommitFailure({
          token,
          nextState: this.deriveRuntimeStateFromSnapshot(previousSnapshot),
          restoreBottomLockState: previousSnapshot.bottomLockState,
          restoreSnapshot: previousSnapshot,
        })
        throw error
      }

      return
    }

    if (mode === 'restored') {
      const restoreTarget = this.resolveRestoreTarget(
        data,
        target ?? data.anchor,
      )

      if (!restoreTarget) {
        this.emitError('bootstrap-restored-target-missing')
        this.state = this.deriveRuntimeStateFromSnapshot(previousSnapshot)
        return
      }

      const renderWindow = this.renderWindow.computeWindowAroundAnchor({
        items: data.items,
        anchorIndex: restoreTarget.index,
        viewportHeight: container.clientHeight,
        viewportWidth: container.clientWidth,
      })

      this.state = 'BOOTSTRAPPING'

      try {
        const projection = this.publishProjection({
          data,
          renderWindow,
          bootstrapState: 'MOUNTING',
          bottomLockState: 'UNLOCKED',
        })

        await this.waitForCommitIfChanged(projection, 'bootstrap')

        if (
          !this.alignToRestoreTarget(
            container,
            restoreTarget,
            'bootstrap-restored-target-dom-missing',
          )
        ) {
          this.recoverAfterCommitFailure({
            token,
            nextState: this.deriveRuntimeStateFromSnapshot(previousSnapshot),
            restoreBottomLockState: previousSnapshot.bottomLockState,
            restoreSnapshot: previousSnapshot,
          })
          return
        }

        this.measureCurrentWindow()
        this.scrollIntent.setBottomLockState('UNLOCKED')
        this.state = 'READY'
        this.publishProjection({
          data,
          renderWindow,
          bootstrapState: 'READY',
          bottomLockState: 'UNLOCKED',
        })
        this.emitEvent({
          type: 'viewportReady',
          feedId: data.feedId,
          generation: data.generation,
        })
      } catch (error) {
        this.recoverAfterCommitFailure({
          token,
          nextState: this.deriveRuntimeStateFromSnapshot(previousSnapshot),
          restoreBottomLockState: previousSnapshot.bottomLockState,
          restoreSnapshot: previousSnapshot,
        })
        throw error
      }

      return
    }

    this.emitError(`bootstrap-${mode}-not-implemented`)
  }

  private enqueuePrependTransaction(): void {
    this.transactions.enqueue('prepend', () => this.runPrependTransaction(), 'prepend')
  }

  private async runPrependTransaction(): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const anchor = this.captureViewportAnchor()

    if (!anchor) {
      this.emitError('prepend-anchor-missing')
      return
    }

    const anchorElementBefore = this.registry.getRow(anchor.key)
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top

    if (typeof anchorTopBefore !== 'number') {
      this.emitError('prepend-anchor-dom-missing')
      return
    }

    const anchorIndex = this.renderWindow.findIndexByKey(data.items, anchor.key)
    const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : 0
    const token = this.lifecycle.getCurrent()
    const previousBottomLockState = this.scrollIntent.getBottomLockState()
    const renderWindow = this.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex: safeAnchorIndex,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })

    this.state = 'TRANSACTING'
    this.scrollIntent.setBottomLockState('RECOVERING')

    try {
      const projection = this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'RECOVERING',
      })

      await this.waitForCommitIfChanged(projection, 'prepend')

      const anchorElementAfter = this.registry.getRow(anchor.key)
      const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

      if (typeof anchorTopAfter !== 'number') {
        this.emitError('prepend-anchor-after-missing')
        this.state = 'READY'
        return
      }

      const delta = anchorTopAfter - anchorTopBefore

      if (Math.abs(delta) > 0.5) {
        this.writeScrollTop(container.scrollTop + delta, 'recovery')
      }

      this.measureCurrentWindow()
      this.scrollIntent.setBottomLockState('UNLOCKED')
      this.state = 'READY'
      this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'UNLOCKED',
      })
    } catch (error) {
      this.recoverAfterCommitFailure({
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

  private enqueueAppendTransaction(effect: 'append' | 'auto-scroll-to-bottom'): void {
    this.transactions.enqueue('append', () => this.runAppendTransaction(effect), 'append')
  }

  private async runAppendTransaction(
    effect: 'append' | 'auto-scroll-to-bottom',
  ): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    // BottomLocked 只代表 feed latest 的底部；hasMoreAfter=true 时，
    // 当前物理底部只是已加载 DataWindow 的 after edge，不能被 append page 追底。
    const shouldFollow =
      !data.hasMoreAfter &&
      (effect === 'auto-scroll-to-bottom' ||
        this.scrollIntent.getBottomLockState() === 'LOCKED')
    const token = this.lifecycle.getCurrent()
    const renderWindow = shouldFollow
      ? this.renderWindow.computeLatestWindow(
          data.items,
          container.clientHeight,
          container.clientWidth,
        )
      : this.keepCurrentWindow(data.items)

    this.state = 'TRANSACTING'
    try {
      const projection = this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: this.scrollIntent.getBottomLockState(),
      })

      await this.waitForCommitIfChanged(projection, 'append')
      this.measureCurrentWindow()

      if (shouldFollow) {
        await this.nextFrame(data.feedId, data.generation)
        this.scrollToBottom('followBottom')
        this.scrollIntent.setBottomLockState('LOCKED')
        this.publishProjection({
          data,
          renderWindow,
          bootstrapState: 'READY',
          bottomLockState: 'LOCKED',
        })
      }

      this.state = 'READY'
    } catch (error) {
      this.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
      })
      throw error
    }
  }

  private enqueueProjectionRefresh(): void {
    this.transactions.enqueue('resize', () => this.runProjectionRefreshTransaction())
  }

  private async runProjectionRefreshTransaction(): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const snapshot = this.store.getSnapshot()
    const renderWindow =
      snapshot.renderWindow.endIndex >= snapshot.renderWindow.startIndex
        ? this.keepCurrentWindow(data.items)
        : this.renderWindow.computeLatestWindow(
            data.items,
            container.clientHeight,
            container.clientWidth,
          )

    if (
      this.scrollIntent.getBottomLockState() === 'LOCKED' &&
      !data.hasMoreAfter
    ) {
      const projection = this.publishProjection({
        data,
        renderWindow,
        bootstrapState: snapshot.bootstrapState,
        bottomLockState: snapshot.bottomLockState,
      })

      await this.waitForCommitIfChanged(projection, 'resize')
      this.measureCurrentWindow()
      this.scrollToBottom('followBottom')
      return
    }

    const anchor = this.captureViewportAnchor()
    const anchorElementBefore = anchor ? this.registry.getRow(anchor.key) : null
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top
    const projection = this.publishProjection({
      data,
      renderWindow,
      bootstrapState: snapshot.bootstrapState,
      bottomLockState: snapshot.bottomLockState,
    })

    await this.waitForCommitIfChanged(projection, 'resize')

    if (anchor && typeof anchorTopBefore === 'number') {
      const anchorElementAfter = this.registry.getRow(anchor.key)
      const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

      if (typeof anchorTopAfter === 'number') {
        const delta = anchorTopAfter - anchorTopBefore

        if (Math.abs(delta) > 0.5) {
          this.writeScrollTop(container.scrollTop + delta, 'recovery')
        }
      }
    }

    this.measureCurrentWindow()
  }

  private enqueueJumpTransaction(messageId: string): void {
    this.transactions.enqueue(
      'jump',
      () => this.runJumpTransaction(messageId),
      'jump',
    )
  }

  private enqueueRestoreTransaction(
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): void {
    this.transactions.enqueue(
      'restore',
      () => this.runRestoreTransaction(target),
      'restore',
    )
  }

  private async runJumpTransaction(messageId: string): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const targetIndex = data.items.findIndex(
      (item) =>
        item.key.kind === 'committed' && item.key.messageId === messageId,
    )

    if (targetIndex < 0) {
      this.emitError('jump-target-missing')
      return
    }

    const token = this.lifecycle.getCurrent()
    const previousBottomLockState = this.scrollIntent.getBottomLockState()
    const renderWindow = this.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex: targetIndex,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })

    try {
      const projection = this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'RECOVERING',
      })

      await this.waitForCommitIfChanged(projection, 'jump')
      const target = this.registry.getRow({ kind: 'committed', messageId })

      if (!target) {
        this.emitError('jump-target-dom-missing')
        return
      }

      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const centerDelta =
        targetRect.top -
        containerRect.top -
        Math.max(0, (container.clientHeight - targetRect.height) / 2)

      this.writeScrollTop(container.scrollTop + centerDelta, 'programmatic')
      this.scrollIntent.setBottomLockState('UNLOCKED')
      this.state = 'READY'
      this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'UNLOCKED',
      })
    } catch (error) {
      this.recoverAfterCommitFailure({
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

  private async runRestoreTransaction(
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const restoreTarget = this.resolveRestoreTarget(data, target)

    if (!restoreTarget) {
      this.emitError('restore-target-missing')
      return
    }

    const token = this.lifecycle.getCurrent()
    const previousBottomLockState = this.scrollIntent.getBottomLockState()
    const renderWindow = this.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex: restoreTarget.index,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })

    this.state = 'TRANSACTING'
    this.scrollIntent.setBottomLockState('RECOVERING')

    try {
      const projection = this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'RECOVERING',
      })

      await this.waitForCommitIfChanged(projection, 'restore')

      if (
        !this.alignToRestoreTarget(
          container,
          restoreTarget,
          'restore-target-dom-missing',
        )
      ) {
        this.scrollIntent.setBottomLockState(previousBottomLockState)
        this.state = 'READY'
        this.publishProjection({
          data,
          renderWindow,
          bootstrapState: 'READY',
          bottomLockState: previousBottomLockState,
        })
        return
      }

      this.measureCurrentWindow()
      this.scrollIntent.setBottomLockState('UNLOCKED')
      this.state = 'READY'
      this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'UNLOCKED',
      })
    } catch (error) {
      this.recoverAfterCommitFailure({
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

  private enqueueResetTransaction(reason: string): void {
    this.transactions.enqueue(
      'reset',
      async () => {
        this.pendingBootstrap = { type: 'bootstrap', mode: 'latest' }
        this.tryRunPendingBootstrap()
        if (!this.dataSnapshot) {
          this.emitError(`reset-${reason}`)
        }
      },
      'reset',
    )
  }

  private enqueueFollowBottomTransaction(): void {
    this.transactions.enqueue(
      'followBottom',
      () => this.runFollowBottomTransaction(),
      'followBottom',
    )
  }

  private async runFollowBottomTransaction(): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    if (data.hasMoreAfter) {
      // followBottom 的目标是会话最新消息；当前 DataWindow 还缺 newer page 时，
      // runtime 只能表达分页需求，不能把 partial bottom 锁成 BottomAnchor。
      this.scrollIntent.setBottomLockState('UNLOCKED')
      this.emitEvent({
        type: 'needMoreAfter',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'bottom-follow',
      })
      return
    }

    const renderWindow = this.renderWindow.computeLatestWindow(
      data.items,
      container.clientHeight,
      container.clientWidth,
    )
    const token = this.lifecycle.getCurrent()
    const previousBottomLockState = this.scrollIntent.getBottomLockState()

    this.state = 'TRANSACTING'
    // follow-bottom 必须先切到 latest projection，再基于 commit 后的真实 DOM 吸底；
    // 如果先写 scrollTop，旧窗口 bottom spacer 的估算误差会把最终位置留在底部上方。
    this.scrollIntent.setBottomLockState('RECOVERING')
    try {
      const projection = this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'RECOVERING',
      })

      await this.waitForCommitIfChanged(projection, 'followBottom')
      this.measureCurrentWindow()
      await this.nextFrame(data.feedId, data.generation)
      this.scrollToBottom('followBottom')
      this.scrollIntent.setBottomLockState('LOCKED')
      this.publishProjection({
        data,
        renderWindow,
        bootstrapState: 'READY',
        bottomLockState: 'LOCKED',
      })
      this.state = 'READY'
    } catch (error) {
      this.recoverAfterCommitFailure({
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

  private publishProjection(input: {
    data: MessageDataSnapshot<TMessage, TOptimistic>
    renderWindow: RenderWindow
    bootstrapState: BootstrapState
    bottomLockState: MessageViewportSnapshot['bottomLockState']
    topSpacer?: number
    bottomSpacer?: number
  }): PublishResult<TMessage, TOptimistic> {
    const container = this.registry.getContainer()
    const width = container?.clientWidth ?? 0
    const topSpacer =
      input.topSpacer ??
      this.spacer.computeTopSpacer(input.data.items, input.renderWindow.startIndex, width)
    const bottomSpacer =
      input.bottomSpacer ??
      this.spacer.computeBottomSpacer(input.data.items, input.renderWindow.endIndex, width)
    const current = this.store.getSnapshot()
    const items = input.data.items.slice(
      input.renderWindow.startIndex,
      input.renderWindow.endIndex + 1,
    )
    const bottomLockState = this.getProjectedBottomLockState(
      input.data,
      input.bottomLockState,
    )
    const nextRevision = this.isProjectionEqual(current, {
      feedId: input.data.feedId,
      generation: input.data.generation,
      items,
      renderWindow: input.renderWindow,
      topSpacer,
      bottomSpacer,
      bottomLockState,
      bootstrapState: input.bootstrapState,
      edgeState: this.createEdgeState(input.data),
    })
      ? current.revision
      : current.revision + 1

    const snapshot: MessageViewportSnapshot<TMessage, TOptimistic> = {
      feedId: input.data.feedId,
      generation: input.data.generation,
      revision: nextRevision,
      items,
      renderWindow: input.renderWindow,
      topSpacer: Math.max(0, topSpacer),
      bottomSpacer: Math.max(0, bottomSpacer),
      bottomLockState,
      bootstrapState: input.bootstrapState,
      edgeState: this.createEdgeState(input.data),
    }

    if (nextRevision !== current.revision) {
      this.store.setSnapshot(snapshot)
      return { snapshot, changed: true }
    }

    return { snapshot: current, changed: false }
  }

  private getProjectedBottomLockState(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    state: MessageViewportSnapshot['bottomLockState'],
  ): MessageViewportSnapshot['bottomLockState'] {
    // Snapshot 不能把 partial DataWindow 的底部暴露成 LOCKED；
    // 否则 React overlay 和接入层会误以为已经回到会话最新消息。
    return data.hasMoreAfter && state === 'LOCKED' ? 'UNLOCKED' : state
  }

  private async waitForCommitIfChanged(
    result: PublishResult<TMessage, TOptimistic>,
    transactionKind: ViewportTransactionKind,
  ): Promise<void> {
    if (!result.changed) {
      return
    }

    await this.waitForCommit(result.snapshot, transactionKind)
  }

  private waitForCommit(
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
    transactionKind: ViewportTransactionKind,
  ): Promise<void> {
    this.cancelPendingCommit()

    return new Promise((resolve, reject) => {
      const timeoutMs =
        transactionKind === 'bootstrap'
          ? this.commitTimeoutMs.bootstrap
          : transactionKind === 'jump'
            ? this.commitTimeoutMs.jump
            : this.commitTimeoutMs.normal
      const timeoutId = this.scheduler.setTimeout(() => {
        this.pendingCommit = null
        this.emitError(`commit-timeout-${transactionKind}`)
        reject(new Error(`Projection commit timed out: ${transactionKind}`))
      }, timeoutMs)

      this.pendingCommit = {
        feedId: snapshot.feedId,
        generation: snapshot.generation,
        revision: snapshot.revision,
        transactionKind,
        timeoutId,
        resolve,
        reject,
      }
    })
  }

  private cancelPendingCommit(): void {
    if (!this.pendingCommit) {
      return
    }

    this.scheduler.clearTimeout(this.pendingCommit.timeoutId)
    this.pendingCommit.reject(new Error('Projection commit cancelled'))
    this.pendingCommit = null
  }

  /**
   * commit timeout / cancel 后不能把 runtime 留在中间态。
   * 这里只恢复当前 generation 仍有效的事务，避免旧事务覆盖 feed 切换或 detach 后的新状态。
   */
  private recoverAfterCommitFailure(input: {
    token: { feedId: string; generation: number }
    nextState: RuntimeState
    restoreBottomLockState?: MessageViewportSnapshot['bottomLockState']
    restoreProjection?: {
      data: MessageDataSnapshot<TMessage, TOptimistic>
      renderWindow: RenderWindow
      bootstrapState: BootstrapState
      bottomLockState: MessageViewportSnapshot['bottomLockState']
    }
    restoreSnapshot?: MessageViewportSnapshot<TMessage, TOptimistic>
  }): void {
    if (!this.lifecycle.isCurrent(input.token.feedId, input.token.generation)) {
      return
    }

    // 先恢复 runtime 内部状态，再发布 projection；这样订阅者拿到新 snapshot 时，
    // debug state / 后续 command 判断都已经脱离失败事务的中间态。
    this.state = input.nextState

    if (typeof input.restoreBottomLockState === 'string') {
      this.scrollIntent.setBottomLockState(input.restoreBottomLockState)
    }

    if (input.restoreSnapshot) {
      this.store.setSnapshot(input.restoreSnapshot)
    } else if (input.restoreProjection) {
      this.publishProjection(input.restoreProjection)
    }
  }

  /**
   * timeout recovery 需要让 runtime.state 与回滚后的 snapshot 语义保持一致。
   * READY / READY_EMPTY 仍然表示可交互稳定态，其余 bootstrap 中间态统一回到 ATTACHED/INITIAL。
   */
  private deriveRuntimeStateFromSnapshot(
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ): RuntimeState {
    if (!this.registry.getContainer()) {
      return 'INITIAL'
    }

    return snapshot.bootstrapState === 'READY' || snapshot.bootstrapState === 'READY_EMPTY'
      ? 'READY'
      : 'ATTACHED'
  }

  private measureCurrentWindow(): HeightDelta[] {
    const snapshot = this.store.getSnapshot()
    const container = this.registry.getContainer()

    if (!container) {
      return []
    }

    return this.measurement.measureMountedRows(
      snapshot.items,
      snapshot.revision,
      container.clientWidth,
    )
  }

  private keepCurrentWindow(items: MessageDataItem<TMessage, TOptimistic>[]): RenderWindow {
    const currentWindow = this.store.getSnapshot().renderWindow
    return this.renderWindow.computeWindowFromRange(
      items,
      currentWindow.startIndex,
      currentWindow.endIndex,
    )
  }

  private resolveRestoreTarget(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): { key: MessageRuntimeItemKey; offsetWithinMessage: number; index: number } | null {
    if (!target) {
      return null
    }

    const key =
      isAnchorState(target)
        ? target.key
        : { kind: 'committed' as const, messageId: target.messageId }
    const offsetWithinMessage = isAnchorState(target)
      ? target.offsetWithinMessage
      : 0
    const index = this.renderWindow.findIndexByKey(data.items, key)

    if (index < 0) {
      return null
    }

    return {
      key,
      offsetWithinMessage: Math.max(0, offsetWithinMessage),
      index,
    }
  }

  private alignToRestoreTarget(
    container: HTMLElement,
    target: {
      key: MessageRuntimeItemKey
      offsetWithinMessage: number
    },
    missingDomErrorCode: string,
  ): boolean {
    const element = this.registry.getRow(target.key)

    if (!element) {
      this.emitError(missingDomErrorCode)
      return false
    }

    const containerTop = container.getBoundingClientRect().top
    const targetRect = element.getBoundingClientRect()
    const desiredTop = containerTop - target.offsetWithinMessage
    const delta = targetRect.top - desiredTop

    if (Math.abs(delta) > 0.5) {
      this.writeScrollTop(container.scrollTop + delta, 'programmatic')
    }

    return true
  }

  private captureViewportAnchor(): AnchorState | null {
    const container = this.registry.getContainer()
    const snapshot = this.store.getSnapshot()

    if (!container) {
      return null
    }

    const containerTop = container.getBoundingClientRect().top

    for (const item of snapshot.items) {
      const key = getRuntimeItemKey(item)
      const element = this.registry.getRow(key)

      if (!element) {
        continue
      }

      const rect = element.getBoundingClientRect()

      if (rect.bottom >= containerTop) {
        return {
          key,
          offsetWithinMessage: Math.max(0, containerTop - rect.top),
        }
      }
    }

    return null
  }

  private scheduleScrollRaf(): void {
    if (this.scrollRaf !== null) {
      return
    }

    const token = this.lifecycle.getCurrent()
    this.scrollRaf = this.scheduler.requestAnimationFrame(() => {
      this.scrollRaf = null
      this.currentFrame += 1

      if (!this.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.handleScrollFrame()
    })
  }

  private handleScrollFrame(): void {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const distance = getDistanceToBottom(container)
    const scrollSource = this.scrollIntent.classifyScroll(this.currentFrame)
    this.lastScrollSource = scrollSource
    const changed = this.updateBottomLockForDataWindow(
      data,
      distance,
      scrollSource,
    )

    if (changed) {
      this.publishProjection({
        data,
        renderWindow: this.keepCurrentWindow(data.items),
        bootstrapState: this.store.getSnapshot().bootstrapState,
        bottomLockState: this.scrollIntent.getBottomLockState(),
      })
    }

    this.emitEdgeNeeds(container, data, scrollSource)

    if (scrollSource === 'user') {
      this.lastUserScrollTop = container.scrollTop
      this.lastUserDistanceToBottom = distance
    }

    if (this.state === 'READY') {
      this.maybeSlideWindow(container, data)
    }
  }

  private updateBottomLockForDataWindow(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    distanceToBottom: number,
    scrollSource: ScrollSource,
  ): boolean {
    // hasMoreAfter=true 说明当前 DOM 底部不是会话最新消息底部，
    // 只能作为向下分页边界，不能进入 BottomLocked 心智模型。
    if (data.hasMoreAfter) {
      return this.scrollIntent.getBottomLockState() === 'RECOVERING'
        ? false
        : this.scrollIntent.setBottomLockState('UNLOCKED')
    }

    return this.scrollIntent.updateBottomLockFromDistance(
      distanceToBottom,
      this.currentFrame,
      scrollSource,
    )
  }

  private maybeSlideWindow(
    container: HTMLElement,
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    const snapshot = this.store.getSnapshot()
    const nearTop = container.scrollTop < snapshot.topSpacer + this.getMinOverscanPx(container)
    const nearBottom =
      getDistanceToBottom(container) <
      snapshot.bottomSpacer + this.getMinOverscanPx(container)

    if (!nearTop && !nearBottom) {
      return
    }

    const anchor = this.captureViewportAnchor()

    if (!anchor) {
      return
    }

    const anchorIndex = this.renderWindow.findIndexByKey(data.items, anchor.key)

    if (anchorIndex < 0) {
      return
    }

    const nextWindow = this.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex,
      viewportHeight: container.clientHeight,
      viewportWidth: container.clientWidth,
    })

    if (this.isRenderWindowEqual(snapshot.renderWindow, nextWindow)) {
      return
    }

    this.transactions.enqueue(
      'resize',
      () =>
        this.runWindowSlideTransaction(anchor.key, nextWindow, {
          feedId: data.feedId,
          generation: data.generation,
          revision: data.revision,
        }),
      'window-slide',
    )
  }

  private async runWindowSlideTransaction(
    anchorKey: MessageRuntimeItemKey,
    nextWindow: RenderWindow,
    expectedData: { feedId: string; generation: number; revision: number },
  ): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

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

    const anchorElementBefore = this.registry.getRow(anchorKey)
    const anchorTopBefore = anchorElementBefore?.getBoundingClientRect().top

    if (typeof anchorTopBefore !== 'number') {
      return
    }

    const projection = this.publishProjection({
      data,
      renderWindow: nextWindow,
      bootstrapState: 'READY',
      bottomLockState: this.scrollIntent.getBottomLockState(),
    })

    await this.waitForCommitIfChanged(projection, 'resize')

    const anchorElementAfter = this.registry.getRow(anchorKey)
    const anchorTopAfter = anchorElementAfter?.getBoundingClientRect().top

    if (typeof anchorTopAfter === 'number') {
      const delta = anchorTopAfter - anchorTopBefore

      if (Math.abs(delta) > 0.5) {
        this.writeScrollTop(container.scrollTop + delta, 'recovery')
      }
    }

    this.measureCurrentWindow()
  }

  private scheduleHeightStabilization(): void {
    if (this.stabilizationRaf !== null) {
      return
    }

    const token = this.lifecycle.getCurrent()
    this.stabilizationRaf = this.scheduler.requestAnimationFrame(() => {
      this.stabilizationRaf = null
      this.currentFrame += 1

      if (!this.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.stabilizeDirtyHeights()
    })
  }

  private stabilizeDirtyHeights(): void {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const deltas = this.measurement.flushPendingHeightDeltas(
      this.store.getSnapshot().revision,
      container.clientWidth,
    )

    if (deltas.length === 0) {
      return
    }

    if (
      this.scrollIntent.getBottomLockState() === 'LOCKED' &&
      !data.hasMoreAfter
    ) {
      this.scrollToBottom('followBottom')
      return
    }

    const anchor = this.captureViewportAnchor()

    if (!anchor) {
      return
    }

    const anchorIndex = this.renderWindow.findIndexByKey(data.items, anchor.key)
    const deltaAboveAnchor = deltas.reduce((total, delta) => {
      const deltaIndex = this.renderWindow.findIndexByKey(data.items, delta.key)
      return deltaIndex >= 0 && deltaIndex < anchorIndex ? total + delta.delta : total
    }, 0)

    if (Math.abs(deltaAboveAnchor) > 0.5) {
      this.writeScrollTop(container.scrollTop + deltaAboveAnchor, 'recovery')
    }
  }

  private setupContainerObserver(container: HTMLElement): void {
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver = this.observerFactory.createResizeObserver(() => {
      this.scheduleResizeRaf()
    })
    this.containerResizeObserver?.observe(container)
  }

  private scheduleResizeRaf(): void {
    if (this.resizeRaf !== null) {
      return
    }

    const token = this.lifecycle.getCurrent()
    this.resizeRaf = this.scheduler.requestAnimationFrame(() => {
      this.resizeRaf = null
      this.currentFrame += 1

      if (!this.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      const container = this.registry.getContainer()
      const data = this.dataSnapshot

      if (!container || !data || !this.measurement.invalidateForWidth(container.clientWidth)) {
        return
      }

      this.publishProjection({
        data,
        renderWindow: this.keepCurrentWindow(data.items),
        bootstrapState: this.store.getSnapshot().bootstrapState,
        bottomLockState: this.scrollIntent.getBottomLockState(),
      })
    })
  }

  private setupIntersectionObserver(container: HTMLElement): void {
    this.intersectionObserver?.disconnect()
    this.intersectionObserver = this.observerFactory.createIntersectionObserver(
      (entries) => this.handleIntersectionEntries(entries),
      {
        root: container,
        rootMargin: `${this.edgeLoadThresholdPx}px 0px`,
        threshold: 0,
      },
    )
    this.observeSentinels()
  }

  private observeSentinels(): void {
    if (!this.intersectionObserver) {
      return
    }

    const top = this.registry.getTopSentinel()
    const bottom = this.registry.getBottomSentinel()

    if (top) {
      this.intersectionObserver.observe(top)
    }

    if (bottom) {
      this.intersectionObserver.observe(bottom)
    }
  }

  private handleIntersectionEntries(entries: IntersectionObserverEntry[]): void {
    const data = this.dataSnapshot

    if (!data) {
      return
    }

    if (!this.canEmitEdgeNeedForSource(this.lastScrollSource)) {
      return
    }

    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue
      }

      if (
        entry.target === this.registry.getTopSentinel() &&
        data.hasMoreBefore &&
        this.isAtBeforeDataEdge() &&
        !this.beforeEdgeRequestLatched
      ) {
        this.beforeEdgeRequestLatched = true
        this.emitEvent({
          type: 'needMoreBefore',
          feedId: data.feedId,
          generation: data.generation,
          reason: 'near-top',
        })
      }

      if (
        entry.target === this.registry.getBottomSentinel() &&
        data.hasMoreAfter &&
        this.isAtAfterDataEdge(data) &&
        !this.afterEdgeRequestLatched
      ) {
        this.afterEdgeRequestLatched = true
        this.emitEvent({
          type: 'needMoreAfter',
          feedId: data.feedId,
          generation: data.generation,
          reason: 'near-bottom',
        })
      }
    }
  }

  private emitEdgeNeeds(
    container: HTMLElement,
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollSource: ScrollSource,
  ): void {
    const nearTop =
      this.isAtBeforeDataEdge() &&
      container.scrollTop <= this.edgeLoadThresholdPx
    const nearBottom =
      this.isAtAfterDataEdge(data) &&
      getDistanceToBottom(container) <= this.edgeLoadThresholdPx
    const distanceToBottom = getDistanceToBottom(container)

    const topReleaseThreshold = this.edgeLoadThresholdPx * 3
    const bottomReleaseThreshold = this.edgeLoadThresholdPx * 3
    const userMovedDownAwayFromTop =
      scrollSource === 'user' &&
      container.scrollTop > topReleaseThreshold &&
      container.scrollTop >= this.lastUserScrollTop
    const userMovedUpAwayFromBottom =
      scrollSource === 'user' &&
      distanceToBottom > bottomReleaseThreshold &&
      distanceToBottom >= this.lastUserDistanceToBottom

    if (userMovedDownAwayFromTop) {
      this.beforeEdgeRequestLatched = false
    }

    if (userMovedUpAwayFromBottom) {
      this.afterEdgeRequestLatched = false
    }

    // 历史分页是用户接近数据边界的意图，不能由 followBottom / recovery 等
    // runtime 写入 scrollTop 的副作用触发，否则短列表吸底时会误拉历史。
    if (!this.canEmitEdgeNeedForSource(scrollSource)) {
      return
    }

    if (nearTop && data.hasMoreBefore && !this.beforeEdgeRequestLatched) {
      this.beforeEdgeRequestLatched = true
      this.emitEvent({
        type: 'needMoreBefore',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'near-top',
      })
    }

    if (nearBottom && data.hasMoreAfter && !this.afterEdgeRequestLatched) {
      this.afterEdgeRequestLatched = true
      this.emitEvent({
        type: 'needMoreAfter',
        feedId: data.feedId,
        generation: data.generation,
        reason: 'near-bottom',
      })
    }
  }

  /**
   * 数据加载事件必须表示“当前已加载 DataWindow 的边界快到了”，
   * 不能用 render overscan 判断；overscan 只服务于 window sliding。
   */
  private isAtBeforeDataEdge(): boolean {
    return this.store.getSnapshot().renderWindow.startIndex === 0
  }

  private canEmitEdgeNeedForSource(source: ScrollSource | null): boolean {
    return source === 'user' || source === 'momentum'
  }

  private isAtAfterDataEdge(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    return this.store.getSnapshot().renderWindow.endIndex >= data.items.length - 1
  }

  private getMinOverscanPx(container: HTMLElement): number {
    return this.config.minOverscanPx > 0
      ? this.config.minOverscanPx
      : container.clientHeight * 2
  }

  private scrollToBottom(source: Extract<ScrollSource, 'followBottom'>): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    this.writeScrollTop(
      Math.max(0, container.scrollHeight - container.clientHeight),
      source,
    )
  }

  private writeScrollTop(nextScrollTop: number, source: ScrollSource): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    this.scrollIntent.markScrollWrite(source, this.currentFrame)
    container.scrollTop = Math.max(0, nextScrollTop)
  }

  private async waitForBootstrapSettle(
    feedId: string,
    generation: number,
  ): Promise<void> {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    const startedAt = this.scheduler.now()
    let stableFrames = 0
    let previousScrollHeight = container.scrollHeight

    while (
      stableFrames < BOOTSTRAP_STABLE_FRAMES &&
      this.scheduler.now() - startedAt < BOOTSTRAP_SETTLE_TIMEOUT_MS
    ) {
      await this.nextFrame(feedId, generation)

      const nextScrollHeight = container.scrollHeight
      const changed =
        Math.abs(nextScrollHeight - previousScrollHeight) >
        BOOTSTRAP_HEIGHT_EPSILON_PX

      stableFrames = changed ? 0 : stableFrames + 1
      previousScrollHeight = nextScrollHeight

      if (this.scrollIntent.getBottomLockState() === 'LOCKED') {
        this.scrollToBottom('followBottom')
      }
    }
  }

  private nextFrame(feedId: string, generation: number): Promise<void> {
    return new Promise((resolve) => {
      this.scheduler.requestAnimationFrame(() => {
        this.currentFrame += 1

        if (this.lifecycle.isCurrent(feedId, generation)) {
          resolve()
          return
        }

        resolve()
      })
    })
  }

  private cancelScheduledWork(): void {
    if (this.scrollRaf !== null) {
      this.scheduler.cancelAnimationFrame(this.scrollRaf)
      this.scrollRaf = null
    }

    if (this.stabilizationRaf !== null) {
      this.scheduler.cancelAnimationFrame(this.stabilizationRaf)
      this.stabilizationRaf = null
    }

    if (this.resizeRaf !== null) {
      this.scheduler.cancelAnimationFrame(this.resizeRaf)
      this.resizeRaf = null
    }
  }

  private createEdgeState(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): ViewportEdgeState {
    return {
      before: data.hasMoreBefore ? 'idle' : 'exhausted',
      after: data.hasMoreAfter ? 'idle' : 'exhausted',
    }
  }

  private isProjectionEqual(
    current: MessageViewportSnapshot<TMessage, TOptimistic>,
    next: Omit<MessageViewportSnapshot<TMessage, TOptimistic>, 'revision'>,
  ): boolean {
    return (
      current.feedId === next.feedId &&
      current.generation === next.generation &&
      current.bootstrapState === next.bootstrapState &&
      current.bottomLockState === next.bottomLockState &&
      Math.abs(current.topSpacer - next.topSpacer) <= 0.5 &&
      Math.abs(current.bottomSpacer - next.bottomSpacer) <= 0.5 &&
      this.isEdgeStateEqual(current.edgeState, next.edgeState) &&
      this.isRenderWindowEqual(current.renderWindow, next.renderWindow) &&
      this.areProjectionItemsEqual(current.items, next.items)
    )
  }

  private isRenderWindowEqual(left: RenderWindow, right: RenderWindow): boolean {
    if (
      left.startIndex !== right.startIndex ||
      left.endIndex !== right.endIndex ||
      left.itemKeys.length !== right.itemKeys.length
    ) {
      return false
    }

    return left.itemKeys.every((key, index) =>
      areRuntimeItemKeysEqual(key, right.itemKeys[index]),
    )
  }

  private areProjectionItemsEqual(
    left: Array<MessageDataItem<TMessage, TOptimistic>>,
    right: Array<MessageDataItem<TMessage, TOptimistic>>,
  ): boolean {
    if (left.length !== right.length) {
      return false
    }

    return left.every((item, index) => {
      const next = right[index]

      return (
        Boolean(next) &&
        areRuntimeItemKeysEqual(getRuntimeItemKey(item), getRuntimeItemKey(next)) &&
        item.version === next.version
      )
    })
  }

  private isEdgeStateEqual(left: ViewportEdgeState, right: ViewportEdgeState): boolean {
    return left.before === right.before && left.after === right.after
  }

  private emitEvent(event: MessageViewportRuntimeEvent): void {
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }

  private emitError(code: string): void {
    const token = this.lifecycle.getCurrent()
    this.emitEvent({
      type: 'viewportError',
      feedId: token.feedId,
      generation: token.generation,
      code,
    })
  }
}

function isAnchorState(
  value: AnchorState | { messageId: string; position?: number } | undefined,
): value is AnchorState {
  return Boolean(value && 'key' in value)
}

function cloneAnchorState(anchor: AnchorState): AnchorState {
  return {
    key: { ...anchor.key },
    offsetWithinMessage: anchor.offsetWithinMessage,
  }
}
