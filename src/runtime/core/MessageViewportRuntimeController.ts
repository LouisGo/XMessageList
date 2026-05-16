import { DomRegistry } from '../dom/domRegistry'
import { LifecycleGuard } from './lifecycleGuard'
import { MeasurementEngine, type HeightDelta } from '../dom/measurementEngine'
import { ProjectionStore, createEmptySnapshot } from './projectionStore'
import { RenderWindowEngine } from '../window/renderWindowEngine'
import { ScrollIntentEngine } from '../scroll/scrollIntentEngine'
import { SpacerEngine, type HeightCache } from '../window/spacerEngine'
import { TransactionRunner } from '../transactions/transactionRunner'
import { CommitCoordinator } from './commitCoordinator'
import { ProjectionCoordinator } from './projectionCoordinator'
import {
  DiagnosticRecorder,
  type RuntimeDiagnosticInput,
} from '../debug/diagnosticRecorder'
import {
  BOOTSTRAP_HEIGHT_EPSILON_PX,
  BOOTSTRAP_SETTLE_TIMEOUT_MS,
  BOOTSTRAP_STABLE_FRAMES,
  DEFAULT_EDGE_LOAD_THRESHOLD_PX,
  DEFAULT_SCROLL_MOTION_OPTIONS,
  USER_SCROLL_DIRECTION_EPSILON_PX,
  VIEWPORT_ANCHOR_IDLE_MS,
  type ActiveFollowBottomIntent,
  cloneAnchorState,
  isAnchorState,
  type BootstrapCommand,
  type CommitRecoveryInput,
  type ContainerSize,
  type DestinationMotionSettle,
  type PendingDestinationRequest,
  type PendingFollowBottom,
  type ReadySubstate,
  type ScrollFrameMetrics,
} from './runtimeTypes'
import { AnchorCoordinator } from '../dom/anchorCoordinator'
import { EdgeNeedCoordinator } from '../events/edgeNeedCoordinator'
import { DestinationMotionCoordinator } from '../scroll/destinationMotionCoordinator'
import { ViewportTransactionController } from '../transactions/viewportTransactionController'
import type {
  AnchorState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageIdentityAnchor,
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
  ScrollMotionOptions,
  ScrollSource,
  ViewportTransactionKind,
  ViewportAnchorChangeReason,
  ViewportDiagnosticRecord,
  NormalizedWindowConfig,
} from '../types'
import {
  DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
  DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
  createDefaultObserverFactory,
  createDefaultScheduler,
  getDistanceToBottom,
  getRuntimeItemKey,
  mergeWindowConfig,
} from '../shared/utils'

/**
 * MessageViewportRuntimeController 是独立于 React 的 IM viewport engine 实现体。
 * 它拥有滚动语义、DOM 测量、anchor 稳定和 transaction；React 只能订阅 projection。
 */
export class MessageViewportRuntimeController<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  private readonly config: NormalizedWindowConfig

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

  private readonly projection: ProjectionCoordinator<TMessage, TOptimistic>

  private readonly commit: CommitCoordinator<TMessage, TOptimistic>

  private readonly anchor: AnchorCoordinator<TMessage, TOptimistic>

  private readonly edge: EdgeNeedCoordinator<TMessage, TOptimistic>

  private readonly motion: DestinationMotionCoordinator<TMessage, TOptimistic>

  private readonly transactions: TransactionRunner

  private readonly transactionController: ViewportTransactionController<
    TMessage,
    TOptimistic
  >

  private readonly eventListeners = new Set<RuntimeEventListener>()

  private readonly commitTimeoutMs: Required<
    NonNullable<MessageViewportRuntimeOptions['commitTimeoutMs']>
  >

  private readonly edgeLoadThresholdPx: number

  private readonly scrollMotionOptions: Required<ScrollMotionOptions>

  private readonly diagnostics: DiagnosticRecorder

  private state: RuntimeState = 'INITIAL'

  private readySubstate: ReadySubstate = 'READY_IDLE'

  private dataSnapshot: MessageDataSnapshot<TMessage, TOptimistic> | null = null

  private pendingBootstrap: BootstrapCommand | null = null

  private pendingFollowBottom: PendingFollowBottom | null = null

  private activeFollowBottomIntent: ActiveFollowBottomIntent | null = null

  private pendingDestinationRequest: PendingDestinationRequest | null = null

  private followBottomCommandCounter = 0

  private destinationCommandCounter = 0

  private scrollRaf: number | null = null

  private stabilizationRaf: number | null = null

  private resizeRaf: number | null = null

  private anchorIdleTimer: number | null = null

  private scrollbarDragEdgeRecheckRaf: number | null = null

  private currentFrame = 0

  private lastScrollSource: ScrollSource | null = null

  private lastDiagnosticScrollSource: ScrollSource | null = null

  private lastDiagnosticBottomLockState:
    | MessageViewportSnapshot['bottomLockState']
    | null = null

  private lastUserScrollTop = 0

  private lastUserDistanceToBottom = 0

  private retainedScrollTop: number | null = null

  private containerResizeObserver: ResizeObserver | null = null

  private lastContainerSize: ContainerSize | null = null

  private scrollbarDragIntentActive = false

  private scrollbarDragEdgeIntent: 'before' | 'after' | null = null

  private readonly handleScroll = (event: Event): void => {
    if (
      this.isScrollbarDragScrollEvent(event) &&
      !this.scrollIntent.hasActiveScrollWrite(this.currentFrame)
    ) {
      this.scrollIntent.markUserIntent(this.currentFrame)
    }

    this.scheduleScrollRaf()
  }

  private readonly handleUserScrollIntent = (): void => {
    this.scrollIntent.markUserIntent(this.currentFrame)
    this.motion.cancel('user-interrupt')
  }

  private readonly handlePointerScrollIntent = (event: PointerEvent): void => {
    if (this.isLikelyScrollbarPointerEvent(event)) {
      this.scrollbarDragIntentActive = true
    }

    this.handleUserScrollIntent()
  }

  private readonly handleMouseScrollIntent = (event: MouseEvent): void => {
    if (this.isLikelyScrollbarPointerEvent(event)) {
      this.scrollbarDragIntentActive = true
    }

    this.handleUserScrollIntent()
  }

  private readonly handleScrollbarDragEnd = (): void => {
    this.scrollbarDragIntentActive = false
    this.scrollbarDragEdgeIntent = null
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
    this.scrollMotionOptions = {
      ...DEFAULT_SCROLL_MOTION_OPTIONS,
      ...options.scrollMotion,
    }
    this.edgeLoadThresholdPx =
      options.edgeLoadThresholdPx ?? DEFAULT_EDGE_LOAD_THRESHOLD_PX
    this.diagnostics = new DiagnosticRecorder(
      options.debug?.diagnostics,
      () => this.scheduler.now(),
      () => this.getDiagnosticContext(),
      (event) => this.emitEvent(event),
    )

    this.store = new ProjectionStore(
      createEmptySnapshot<TMessage, TOptimistic>(feedId, generation),
    )
    this.lifecycle = new LifecycleGuard(feedId, generation)
    this.spacer = new SpacerEngine(this.heightCache)
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
    this.projection = new ProjectionCoordinator(
      this.store,
      this.registry,
      this.spacer,
      (input) => this.emitDiagnostic(input),
    )
    this.commit = new CommitCoordinator(
      this.scheduler,
      this.commitTimeoutMs,
      (code) => this.emitError(code),
    )
    this.anchor = new AnchorCoordinator(
      this.registry,
      this.store,
      this.renderWindow,
      (currentFeedId, currentGeneration) =>
        this.nextFrame(currentFeedId, currentGeneration),
      (nextScrollTop, source) => this.motion.writeScrollTop(nextScrollTop, source),
      (code) => this.emitError(code),
    )
    this.edge = new EdgeNeedCoordinator(
      this.registry,
      this.store,
      this.observerFactory,
      this.edgeLoadThresholdPx,
      () => this.dataSnapshot,
      () => this.lastScrollSource,
      () => this.canEmitEdgeNeeds(),
      () => this.pendingFollowBottom !== null,
      (event) => this.emitEvent(event),
    )
    this.motion = new DestinationMotionCoordinator(
      this.registry,
      this.store,
      this.scheduler,
      this.scrollIntent,
      this.projection,
      this.scrollMotionOptions,
      (substate) => {
        this.readySubstate = substate
      },
      () => this.currentFrame,
      () => this.state === 'DESTROYED',
      (reason) => this.emitViewportAnchorChanged(reason),
      (settle) => this.handleDestinationMotionSettle(settle),
      (scrollTop, source) =>
        this.recordActiveFollowBottomIntentScrollWrite(scrollTop, source),
      (input) => this.emitDiagnostic(input),
    )
    this.transactions = new TransactionRunner({
      onEnqueue: (kind, id) =>
        this.emitTransactionDiagnostic('enqueue', kind, id),
      onStart: (kind, id) => {
        this.emitTransactionDiagnostic('start', kind, id)
        this.motion.cancel('transaction-supersede', {
          transactionKind: kind,
          transactionId: id,
        })
      },
      onComplete: (kind, id) =>
        this.emitTransactionDiagnostic('complete', kind, id),
      onDrop: (kind, id, reason) =>
        this.emitTransactionDiagnostic('drop', kind, id, { reason }),
      onError: (kind, id, error) =>
        this.emitTransactionDiagnostic('error', kind, id, {
          error: error instanceof Error ? error.message : String(error),
        }),
    })
    this.transactionController = new ViewportTransactionController({
      registry: this.registry,
      store: this.store,
      lifecycle: this.lifecycle,
      renderWindow: this.renderWindow,
      measurement: this.measurement,
      scrollIntent: this.scrollIntent,
      projection: this.projection,
      commit: this.commit,
      anchor: this.anchor,
      motion: this.motion,
      getDataSnapshot: () => this.dataSnapshot,
      setState: (state) => {
        this.state = state
      },
      setPendingBootstrap: (command) => {
        this.pendingBootstrap = command
      },
      tryRunPendingBootstrap: () => this.tryRunPendingBootstrap(),
      startPendingFollowBottom: (data, scrollTop) =>
        this.startPendingFollowBottom(data, scrollTop),
      hasActiveFollowBottomIntent: (data) =>
        this.hasActiveFollowBottomIntent(data),
      clearActiveFollowBottomIntent: (reason) =>
        this.clearActiveFollowBottomIntent(reason),
      reconcileBottomLockFromViewport: (data, reason) =>
        this.reconcileBottomLockFromViewport(data, reason),
      keepCurrentWindow: (items) => this.keepCurrentWindow(items),
      measureCurrentWindow: () => this.measureCurrentWindow(),
      waitForBootstrapSettle: (currentFeedId, currentGeneration) =>
        this.waitForBootstrapSettle(currentFeedId, currentGeneration),
      recoverAfterCommitFailure: (input) =>
        this.recoverAfterCommitFailure(input),
      deriveRuntimeStateFromSnapshot: (snapshot) =>
        this.deriveRuntimeStateFromSnapshot(snapshot),
      emitViewportAnchorChanged: (reason, anchor) =>
        this.emitViewportAnchorChanged(reason, anchor),
      invalidateSpacerCache: () => this.spacer.invalidateEstimateCache(),
      emitEvent: (event) => this.emitEvent(event),
      emitDiagnostic: (input) => this.emitDiagnostic(input),
      emitError: (code) => this.emitError(code),
    })
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
    this.scrollIntent.clearTransientIntent()
    this.scrollIntent.markScrollWrite('programmatic', this.currentFrame)
    this.lastScrollSource = null
    this.registry.attachContainer(container)
    // detach/attach 同一个 runtime 实例时保留 scrollTop，feed 切换缓存复用不能闪回顶部。
    container.scrollTop = Math.max(0, this.retainedScrollTop ?? 0)
    this.lastUserScrollTop = container.scrollTop
    this.lastUserDistanceToBottom = getDistanceToBottom(container)
    this.lastContainerSize = this.readContainerSize(container)
    container.addEventListener('scroll', this.handleScroll, { passive: true })
    container.addEventListener('wheel', this.handleUserScrollIntent, { passive: true })
    container.addEventListener('touchstart', this.handleUserScrollIntent, {
      passive: true,
    })
    container.addEventListener('pointerdown', this.handlePointerScrollIntent)
    container.addEventListener('mousedown', this.handleMouseScrollIntent)
    container.addEventListener('keydown', this.handleUserScrollIntent)
    window.addEventListener('pointerup', this.handleScrollbarDragEnd)
    window.addEventListener('mouseup', this.handleScrollbarDragEnd)
    window.addEventListener('blur', this.handleScrollbarDragEnd)
    this.setupContainerObserver(container)
    this.edge.setupIntersectionObserver(container)
    this.state =
      this.store.getSnapshot().bootstrapState === 'READY' ? 'READY' : 'ATTACHED'
    this.readySubstate = this.state === 'READY' ? 'READY_IDLE' : this.readySubstate
    this.emitDiagnostic({
      channel: 'lifecycle',
      severity: 'info',
      name: 'lifecycle.attach',
      details: () => ({
        restoredScrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        clientWidth: container.clientWidth,
        bootstrapState: this.store.getSnapshot().bootstrapState,
      }),
    })
    this.reconcileReadyBottomLockFromViewport('attach')
    this.tryRunPendingBootstrap()
  }

  detach(): void {
    if (this.state === 'DESTROYED') {
      return
    }

    const container = this.registry.getContainer()

    this.emitDiagnostic({
      channel: 'lifecycle',
      severity: 'info',
      name: 'lifecycle.detach',
      details: () => ({
        scrollTop: container?.scrollTop ?? null,
        hasContainer: Boolean(container),
      }),
    })
    this.lifecycle.suspend()
    this.clearPendingFollowBottom()
    this.clearActiveFollowBottomIntent('detach')
    this.clearPendingDestinationRequest()
    this.motion.cancel('detach')
    this.commit.cancelPendingCommit()
    this.cancelScheduledWork()
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver = null
    this.edge.disconnect()
    this.measurement.disconnect()
    this.transactions.clear()

    this.emitViewportAnchorChanged('detach')

    if (container) {
      this.retainedScrollTop = container.scrollTop
      container.removeEventListener('scroll', this.handleScroll)
      container.removeEventListener('wheel', this.handleUserScrollIntent)
      container.removeEventListener('touchstart', this.handleUserScrollIntent)
      container.removeEventListener('pointerdown', this.handlePointerScrollIntent)
      container.removeEventListener('mousedown', this.handleMouseScrollIntent)
      container.removeEventListener('keydown', this.handleUserScrollIntent)
      window.removeEventListener('pointerup', this.handleScrollbarDragEnd)
      window.removeEventListener('mouseup', this.handleScrollbarDragEnd)
      window.removeEventListener('blur', this.handleScrollbarDragEnd)
    }

    this.scrollIntent.clearTransientIntent()
    this.lastScrollSource = null
    this.registry.clearDomRefs()
    this.lastContainerSize = null
    this.readySubstate = 'READY_IDLE'
    this.state = 'DETACHED'
  }

  destroy(): void {
    if (this.state === 'DESTROYED') {
      return
    }

    this.emitDiagnostic({
      channel: 'lifecycle',
      severity: 'info',
      name: 'lifecycle.destroy',
      details: () => ({
        heightCacheSize: this.heightCache.size,
        observedRows: this.registry.getSnapshot().observedRows,
      }),
    })
    this.detach()
    this.lifecycle.destroy()
    this.transactions.stop()
    this.clearPendingFollowBottom()
    this.clearActiveFollowBottomIntent('destroy')
    this.clearPendingDestinationRequest()
    this.motion.cancel('destroy')
    this.heightCache.clear()
    this.eventListeners.clear()
    this.store.clearListeners()
    this.retainedScrollTop = null
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
    const dataIdentityChanged =
      generationChanged ||
      previous?.revision !== snapshot.revision

    if (generationChanged) {
      // feed/generation 是 runtime 隔离边界；旧 generation 的 measurement、事务和 edge latch 都不能复用。
      this.resetForGeneration(snapshot.feedId, snapshot.generation)
    } else if (dataIdentityChanged) {
      // 派生 index/range cache 只能在同一个 data revision 内复用；不能把 items array 引用当作数据身份。
      this.renderWindow.invalidateIndexCache()
    }

    this.dataSnapshot = snapshot
    if (generationChanged) {
      this.emitDiagnostic({
        channel: 'lifecycle',
        severity: 'info',
        name: 'lifecycle.generationReset',
        correlationId:
          `data:${snapshot.feedId}:${snapshot.generation}:${snapshot.revision}`,
        details: () => ({
          previousFeedId: previous?.feedId ?? null,
          previousGeneration: previous?.generation ?? null,
          nextFeedId: snapshot.feedId,
          nextGeneration: snapshot.generation,
        }),
      })
    }
    this.emitDiagnostic({
      channel: 'data',
      severity: 'debug',
      name: 'data.setSnapshot',
      correlationId:
        `data:${snapshot.feedId}:${snapshot.generation}:${snapshot.revision}`,
      details: () => ({
        revision: snapshot.revision,
        itemCount: snapshot.items.length,
        effect: snapshot.change.viewportEffect,
        kind: snapshot.change.kind,
        hasMoreBefore: snapshot.hasMoreBefore,
        hasMoreAfter: snapshot.hasMoreAfter,
        anchor: snapshot.anchor ?? null,
        anchorStatus: snapshot.anchorStatus ?? null,
        firstKey: snapshot.items[0]
          ? getRuntimeItemKey(snapshot.items[0])
          : null,
        lastKey: snapshot.items[snapshot.items.length - 1]
          ? getRuntimeItemKey(snapshot.items[snapshot.items.length - 1])
          : null,
        generationChanged,
      }),
    })

    if (snapshot.hasMoreAfter && this.scrollIntent.getBottomLockState() === 'LOCKED') {
      // 只有真正到达 feed latest 才能保持 LOCKED；partial after window 的物理底部不是会话底部。
      this.scrollIntent.setBottomLockState('UNLOCKED')
    }

    if (snapshot.change.viewportEffect !== 'none') {
      this.transactions.dropBySupersedeKey('window-slide')
    }

    if (this.tryRunPendingBootstrap()) {
      return
    }

    if (this.drivePendingFollowBottom(snapshot)) {
      return
    }

    if (this.drivePendingDestinationRequest(snapshot)) {
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
    if (!this.canAcceptCommand(command)) {
      this.emitDiagnostic({
        channel: 'transaction',
        severity: 'warn',
        name: 'command.rejected',
        correlationId: `command:${command.type}`,
        details: () => ({
          commandType: command.type,
          state: this.state,
          readySubstate: this.readySubstate,
        }),
      })
      return
    }

    switch (command.type) {
      case 'bootstrap':
        this.pendingBootstrap = command
        this.tryRunPendingBootstrap()
        break
      case 'followBottom':
        this.clearPendingDestinationRequest()
        this.startFollowBottomCommand()
        break
      case 'jump':
        this.clearPendingFollowBottom()
        this.clearActiveFollowBottomIntent('jump')
        this.startJumpCommand(command.target)
        break
      case 'restore':
        this.clearPendingFollowBottom()
        this.clearActiveFollowBottomIntent('restore')
        this.startRestoreCommand(command.target)
        break
      case 'reset':
        this.clearPendingFollowBottom()
        this.clearActiveFollowBottomIntent('reset')
        this.clearPendingDestinationRequest()
        this.enqueueResetTransaction(command.reason)
        break
    }
  }

  private canAcceptCommand(command: MessageRuntimeCommand): boolean {
    if (this.state === 'DESTROYED') {
      return false
    }

    if (command.type === 'reset') {
      return true
    }

    if (this.state === 'INITIAL') {
      return command.type === 'bootstrap'
    }

    if (this.state === 'ATTACHED' || this.state === 'DETACHED') {
      return command.type === 'bootstrap'
    }

    if (command.type === 'followBottom') {
      return this.state === 'READY'
    }

    if (command.type === 'jump' || command.type === 'restore') {
      return this.state === 'READY' || this.state === 'TRANSACTING'
    }

    return true
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

  getDiagnosticRecords(): ViewportDiagnosticRecord[] {
    return this.diagnostics.getRecords()
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
    this.edge.observeSentinels()
  }

  registerBottomSentinel(element: HTMLElement | null): void {
    this.registry.registerBottomSentinel(element)
    this.edge.observeSentinels()
  }

  notifyProjectionCommitted(commit: ProjectionCommit): void {
    this.commit.notifyProjectionCommitted(commit)
  }

  getDebugSnapshot(): {
    state: RuntimeState
    readySubstate: ReadySubstate
    pendingCommands: number
    motionActive: boolean
    observedRows: number
    heightCacheSize: number
    lastScrollSource: ScrollSource | null
  } {
    return {
      state: this.state,
      readySubstate: this.readySubstate,
      pendingCommands: this.transactions.getPendingCount(),
      motionActive: this.motion.isActive(),
      observedRows: this.registry.getSnapshot().observedRows,
      heightCacheSize: this.heightCache.size,
      lastScrollSource: this.lastScrollSource,
    }
  }

  private tryRunPendingBootstrap(): boolean {
    if (!this.pendingBootstrap || !this.dataSnapshot || !this.registry.getContainer()) {
      return false
    }

    const command = this.pendingBootstrap
    this.pendingBootstrap = null
    // bootstrap 只在 data + container 都就绪后入队；否则会发布无法 commit 的 projection。
    this.transactions.enqueue(
      'bootstrap',
      () =>
        this.transactionController.runBootstrapTransaction(
          command.mode,
          command.target,
        ),
      'bootstrap',
    )
    return true
  }

  private startFollowBottomCommand(): void {
    const data = this.dataSnapshot

    if (!data) {
      return
    }

    const commandId = this.startActiveFollowBottomIntent(
      data,
      this.registry.getContainer()?.scrollTop ?? 0,
    ).commandId

    if (data.hasMoreAfter) {
      // followBottom 面向 feed latest；当前 DataWindow 还缺 latest page 时请求 latest window。
      this.startPendingFollowBottom(
        data,
        this.registry.getContainer()?.scrollTop ?? 0,
        commandId,
      )
      return
    }

    this.enqueueFollowBottomTransaction()
  }

  private startJumpCommand(target: MessageIdentityAnchor): void {
    const data = this.dataSnapshot

    if (!data) {
      return
    }

    if (!this.hasCommittedMessage(data, target.messageId)) {
      this.startPendingDestinationRequest('jump', target, target)
      return
    }

    this.clearPendingDestinationRequest()
    this.enqueueJumpTransaction(target.messageId)
  }

  private startRestoreCommand(target: AnchorState | MessageIdentityAnchor): void {
    const data = this.dataSnapshot

    if (!data) {
      return
    }

    const identityTarget = this.getIdentityTarget(target)

    if (identityTarget && !this.hasCommittedMessage(data, identityTarget.messageId)) {
      this.startPendingDestinationRequest('restore', identityTarget, target)
      return
    }

    this.clearPendingDestinationRequest()
    this.enqueueRestoreTransaction(target)
  }

  private drivePendingFollowBottom(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    const pending = this.pendingFollowBottom

    if (!pending) {
      return false
    }

    if (
      pending.feedId !== snapshot.feedId ||
      pending.generation !== snapshot.generation
    ) {
      this.clearPendingFollowBottom()
      this.clearActiveFollowBottomIntent('generation-change')
      return false
    }

    if (snapshot.hasMoreAfter) {
      // 每个 data revision 最多发一次 latest-window need，避免 BFF 未返回时重复拉取。
      this.emitPendingFollowBottomNeed(snapshot)
      return true
    }

    this.clearPendingFollowBottom()
    this.enqueueFollowBottomTransaction()
    return true
  }

  private drivePendingDestinationRequest(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    const pending = this.pendingDestinationRequest

    if (!pending) {
      return false
    }

    if (
      pending.feedId !== snapshot.feedId ||
      pending.generation !== snapshot.generation
    ) {
      this.clearPendingDestinationRequest()
      return false
    }

    if (!this.hasCommittedMessage(snapshot, pending.target.messageId)) {
      this.emitPendingDestinationNeed(snapshot)
      return true
    }

    this.clearPendingDestinationRequest()

    if (pending.intent === 'jump') {
      this.enqueueJumpTransaction(pending.target.messageId)
      return true
    }

    this.enqueueRestoreTransaction(pending.commandTarget)
    return true
  }

  private emitPendingFollowBottomNeed(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    const pending = this.pendingFollowBottom

    if (!pending || pending.emittedAfterRevision === data.revision) {
      return
    }

    pending.emittedAfterRevision = data.revision
    this.edge.setAfterEdgeLatched(true)
    this.emitEvent({
      type: 'needLatestMessages',
      feedId: data.feedId,
      generation: data.generation,
      reason: 'bottom-follow',
    })
  }

  private emitPendingDestinationNeed(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    const pending = this.pendingDestinationRequest

    if (!pending || pending.emittedAfterRevision === data.revision) {
      return
    }

    pending.emittedAfterRevision = data.revision
    this.emitEvent({
      type: 'needMessagesAround',
      feedId: data.feedId,
      generation: data.generation,
      reason: pending.intent,
      target: { ...pending.target },
    })
  }

  private clearPendingFollowBottom(): void {
    if (!this.pendingFollowBottom) {
      return
    }

    this.pendingFollowBottom = null

    if (this.readySubstate === 'READY_FOLLOW_BOTTOM_PENDING') {
      this.readySubstate = 'READY_IDLE'
    }
  }

  private clearPendingDestinationRequest(): void {
    if (!this.pendingDestinationRequest) {
      return
    }

    this.pendingDestinationRequest = null

    if (this.readySubstate === 'READY_DESTINATION_PENDING') {
      this.readySubstate = 'READY_IDLE'
    }
  }

  private startActiveFollowBottomIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
  ): ActiveFollowBottomIntent {
    this.followBottomCommandCounter += 1
    const intent = {
      feedId: data.feedId,
      generation: data.generation,
      commandId: `follow-bottom-${this.followBottomCommandCounter}`,
      lastScrollTop: scrollTop,
    }

    this.activeFollowBottomIntent = intent
    this.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'followBottom.intent.start',
      correlationId: `command:${intent.commandId}`,
      details: () => ({
        revision: data.revision,
        itemCount: data.items.length,
        hasMoreAfter: data.hasMoreAfter,
        scrollTop,
      }),
    })
    return intent
  }

  private ensureActiveFollowBottomIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
  ): ActiveFollowBottomIntent {
    if (this.hasActiveFollowBottomIntent(data)) {
      const intent = this.activeFollowBottomIntent as ActiveFollowBottomIntent
      intent.lastScrollTop = scrollTop
      return intent
    }

    return this.startActiveFollowBottomIntent(data, scrollTop)
  }

  private hasActiveFollowBottomIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    return (
      this.activeFollowBottomIntent?.feedId === data.feedId &&
      this.activeFollowBottomIntent.generation === data.generation
    )
  }

  private clearActiveFollowBottomIntent(reason: string): void {
    const intent = this.activeFollowBottomIntent

    if (!intent) {
      return
    }

    this.activeFollowBottomIntent = null
    this.emitDiagnostic({
      channel: 'motion',
      severity: 'debug',
      name: 'followBottom.intent.clear',
      correlationId: `command:${intent.commandId}`,
      details: () => ({
        reason,
        feedId: intent.feedId,
        generation: intent.generation,
        lastScrollTop: intent.lastScrollTop,
      }),
    })
  }

  private updateActiveFollowBottomIntentForScroll(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    scrollSource: ScrollSource,
  ): void {
    const intent = this.activeFollowBottomIntent

    if (!intent) {
      return
    }

    if (intent.feedId !== data.feedId || intent.generation !== data.generation) {
      this.clearActiveFollowBottomIntent('generation-change')
      return
    }

    if (
      scrollSource === 'user' &&
      scrollTop < intent.lastScrollTop - USER_SCROLL_DIRECTION_EPSILON_PX
    ) {
      this.clearActiveFollowBottomIntent('user-scroll-up')
      this.clearPendingFollowBottom()
      return
    }

    intent.lastScrollTop = scrollTop
  }

  private recordActiveFollowBottomIntentScrollWrite(
    scrollTop: number,
    source: ScrollSource,
  ): void {
    const intent = this.activeFollowBottomIntent
    const data = this.dataSnapshot

    if (
      !intent ||
      !data ||
      source !== 'followBottom' ||
      intent.feedId !== data.feedId ||
      intent.generation !== data.generation
    ) {
      return
    }

    intent.lastScrollTop = scrollTop
  }

  private handleDestinationMotionSettle(
    settle: DestinationMotionSettle<TMessage, TOptimistic>,
  ): void {
    if (
      settle.source !== 'followBottom' ||
      settle.bottomLockState !== 'LOCKED' ||
      !this.hasActiveFollowBottomIntent(settle.data)
    ) {
      return
    }

    this.clearActiveFollowBottomIntent('settled-locked')
  }

  private updatePendingFollowBottomForUserScroll(scrollTop: number): void {
    const pending = this.pendingFollowBottom

    if (!pending) {
      return
    }

    if (scrollTop < pending.lastScrollTop - USER_SCROLL_DIRECTION_EPSILON_PX) {
      // 用户主动向上阅读时，pending follow-bottom 必须让位，不能继续追逐 latest。
      this.clearPendingFollowBottom()
      this.clearActiveFollowBottomIntent('user-scroll-up')
      return
    }

    pending.lastScrollTop = scrollTop
  }

  private canEmitEdgeNeeds(): boolean {
    const snapshot = this.store.getSnapshot()

    return (
      this.state === 'READY' &&
      this.readySubstate === 'READY_IDLE' &&
      snapshot.bootstrapState === 'READY'
    )
  }

  private startPendingFollowBottom(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    commandId?: string,
  ): void {
    const resolvedCommandId =
      commandId ?? this.ensureActiveFollowBottomIntent(data, scrollTop).commandId
    this.pendingFollowBottom = {
      feedId: data.feedId,
      generation: data.generation,
      commandId: resolvedCommandId,
      emittedAfterRevision: null,
      lastScrollTop: scrollTop,
    }
    this.readySubstate = 'READY_FOLLOW_BOTTOM_PENDING'
    this.scrollIntent.setBottomLockState('UNLOCKED')
    this.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'followBottom.pending',
      correlationId: `command:${resolvedCommandId}`,
      details: () => ({
        revision: data.revision,
        itemCount: data.items.length,
        hasMoreBefore: data.hasMoreBefore,
        hasMoreAfter: data.hasMoreAfter,
        scrollTop,
      }),
    })
    this.emitPendingFollowBottomNeed(data)
  }

  private startPendingDestinationRequest(
    intent: 'jump' | 'restore',
    target: MessageIdentityAnchor,
    commandTarget: AnchorState | MessageIdentityAnchor,
  ): void {
    const data = this.dataSnapshot

    if (!data) {
      return
    }

    this.destinationCommandCounter += 1
    this.pendingDestinationRequest = {
      feedId: data.feedId,
      generation: data.generation,
      commandId: `${intent}-${this.destinationCommandCounter}`,
      intent,
      target: { ...target },
      commandTarget: this.cloneDestinationCommandTarget(commandTarget),
      emittedAfterRevision: null,
    }
    this.readySubstate = 'READY_DESTINATION_PENDING'
    this.scrollIntent.setBottomLockState('UNLOCKED')
    this.emitPendingDestinationNeed(data)
  }

  private hasCommittedMessage(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    messageId: string,
  ): boolean {
    return this.renderWindow.findCommittedMessageIndex(data.items, messageId) >= 0
  }

  private getIdentityTarget(
    target: AnchorState | MessageIdentityAnchor,
  ): MessageIdentityAnchor | null {
    if (!isAnchorState(target)) {
      return { ...target }
    }

    if (target.key.kind !== 'committed') {
      return null
    }

    return { messageId: target.key.messageId }
  }

  private cloneDestinationCommandTarget(
    target: AnchorState | MessageIdentityAnchor,
  ): AnchorState | MessageIdentityAnchor {
    return isAnchorState(target) ? cloneAnchorState(target) : { ...target }
  }

  private resetForGeneration(feedId: string, generation: number): void {
    this.clearPendingFollowBottom()
    this.clearActiveFollowBottomIntent('generation-change')
    this.clearPendingDestinationRequest()
    this.motion.cancel('generation-change')
    this.lifecycle.reset(feedId, generation)
    this.transactions.clear()
    this.commit.cancelPendingCommit()
    this.cancelScheduledWork()
    this.heightCache.clear()
    this.renderWindow.invalidateIndexCache()
    this.spacer.invalidateEstimateCache()
    this.edge.resetLatches()
    this.lastScrollSource = null
    this.scrollIntent.clearTransientIntent()
    this.readySubstate = 'READY_IDLE'
    this.scrollIntent.setBottomLockState('UNLOCKED')
    // 先发布空 snapshot，让 React projection 明确切到新 feed，再等待新的 bootstrap。
    this.store.setSnapshot(createEmptySnapshot<TMessage, TOptimistic>(feedId, generation))
    this.state = this.registry.getContainer() ? 'ATTACHED' : 'INITIAL'
  }

  private enqueuePrependTransaction(): void {
    this.transactions.enqueue(
      'prepend',
      () => this.transactionController.runPrependTransaction(),
      'prepend',
    )
  }

  private enqueueAppendTransaction(effect: 'append' | 'auto-scroll-to-bottom'): void {
    this.transactions.enqueue(
      'append',
      () => this.transactionController.runAppendTransaction(effect),
      'append',
    )
  }

  private enqueueProjectionRefresh(): void {
    this.transactions.enqueue(
      'resize',
      () => this.transactionController.runProjectionRefreshTransaction(),
    )
  }

  private enqueueJumpTransaction(messageId: string): void {
    this.transactions.enqueue(
      'jump',
      () => this.transactionController.runJumpTransaction(messageId),
      'jump',
    )
  }

  private enqueueRestoreTransaction(
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): void {
    this.transactions.enqueue(
      'restore',
      () => this.transactionController.runRestoreTransaction(target),
      'restore',
    )
  }

  private enqueueResetTransaction(reason: string): void {
    this.transactions.enqueue(
      'reset',
      () => this.transactionController.runReset(reason),
      'reset',
    )
  }

  private enqueueFollowBottomTransaction(): void {
    this.transactions.enqueue(
      'followBottom',
      () => this.transactionController.runFollowBottomTransaction(),
      'followBottom',
    )
  }

  private emitTransactionDiagnostic(
    phase: 'enqueue' | 'start' | 'complete' | 'drop' | 'error',
    kind: ViewportTransactionKind,
    id: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.emitDiagnostic({
      channel: 'transaction',
      severity: phase === 'error' ? 'error' : 'debug',
      name: `transaction.${phase}`,
      correlationId: `transaction:${id}`,
      details: () => ({
        kind,
        id,
        queueDepth: this.transactions.getPendingCount(),
        ...extra,
      }),
    })
  }

  /**
   * commit timeout / cancel 后不能把 runtime 留在中间态。
   * 这里只恢复当前 generation 仍有效的事务，避免旧事务覆盖 feed 切换或 detach 后的新状态。
   */
  private recoverAfterCommitFailure(
    input: CommitRecoveryInput<TMessage, TOptimistic>,
  ): void {
    if (!this.lifecycle.isCurrent(input.token.feedId, input.token.generation)) {
      return
    }

    this.emitDiagnostic({
      channel: 'recovery',
      severity: 'warn',
      name: 'recovery.commitFailure',
      details: () => ({
        token: input.token,
        nextState: input.nextState,
        restoreBottomLockState: input.restoreBottomLockState ?? null,
        hasRestoreSnapshot: Boolean(input.restoreSnapshot),
        hasRestoreProjection: Boolean(input.restoreProjection),
      }),
    })

    // 先恢复 runtime 内部状态，再发布 projection；这样订阅者拿到新 snapshot 时，
    // debug state / 后续 command 判断都已经脱离失败事务的中间态。
    this.state = input.nextState

    if (typeof input.restoreBottomLockState === 'string') {
      this.scrollIntent.setBottomLockState(input.restoreBottomLockState)
    }

    if (input.restoreSnapshot) {
      this.store.setSnapshot(input.restoreSnapshot)
    } else if (input.restoreProjection) {
      this.projection.publish(input.restoreProjection)
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

    const deltas = this.measurement.measureMountedRows(
      snapshot.items,
      snapshot.revision,
      container.clientWidth,
    )

    if (deltas.length > 0) {
      this.spacer.invalidateEstimateCache()
      this.emitDiagnostic({
        channel: 'measurement',
        severity: 'debug',
        name: 'measurement.mountedRows',
        correlationId:
          `data:${snapshot.feedId}:${snapshot.generation}:${snapshot.revision}`,
        details: () => ({
          revision: snapshot.revision,
          deltaCount: deltas.length,
          totalDelta: deltas.reduce((total, delta) => total + delta.delta, 0),
          sample: deltas.slice(0, 5).map((delta) => ({
            key: delta.serializedKey,
            previousHeight: delta.previousHeight,
            nextHeight: delta.nextHeight,
            delta: delta.delta,
          })),
        }),
      })
    }

    return deltas
  }

  private keepCurrentWindow(items: MessageDataItem<TMessage, TOptimistic>[]): RenderWindow {
    const currentWindow = this.store.getSnapshot().renderWindow
    return this.renderWindow.computeWindowFromRange(
      items,
      currentWindow.startIndex,
      currentWindow.endIndex,
    )
  }

  private captureViewportAnchor(): AnchorState | null {
    return this.anchor.captureViewportAnchor()
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

  private scheduleScrollbarDragEdgeRecheck(reason: string): void {
    if (
      !this.scrollbarDragIntentActive ||
      this.scrollbarDragEdgeRecheckRaf !== null
    ) {
      return
    }

    const token = this.lifecycle.getCurrent()
    this.scrollbarDragEdgeRecheckRaf = this.scheduler.requestAnimationFrame(() => {
      this.scrollbarDragEdgeRecheckRaf = null
      this.currentFrame += 1

      if (!this.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.handleScrollbarDragEdgeRecheckFrame(reason)
    })
  }

  private handleScrollbarDragEdgeRecheckFrame(reason: string): void {
    if (!this.scrollbarDragIntentActive || this.state !== 'READY') {
      return
    }

    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const metrics = this.readScrollFrameMetrics(container)
    const edgeMetrics = this.getScrollbarDragEdgeIntentMetrics(data, metrics)
    this.lastScrollSource = 'user'
    this.emitDiagnostic({
      channel: 'edge',
      severity: 'debug',
      name: 'edge.scrollbarDragRecheck',
      details: () => ({
        reason,
        edgeIntent: this.scrollbarDragEdgeIntent,
        scrollTop: edgeMetrics.scrollTop,
        distanceToBottom: edgeMetrics.distanceToBottom,
        actualScrollTop: metrics.scrollTop,
        actualDistanceToBottom: metrics.distanceToBottom,
        scrollHeight: edgeMetrics.scrollHeight,
        clientHeight: edgeMetrics.clientHeight,
      }),
    })
    this.edge.emitEdgeNeeds({
      data,
      metrics: edgeMetrics,
      scrollSource: 'user',
      lastUserScrollTop: this.lastUserScrollTop,
      lastUserDistanceToBottom: this.lastUserDistanceToBottom,
    })
    if (this.scrollbarDragEdgeIntent) {
      this.edge.emitScrollbarDragEdgeNeed({
        data,
        edge: this.scrollbarDragEdgeIntent,
      })
    }
    this.lastUserScrollTop = edgeMetrics.scrollTop
    this.lastUserDistanceToBottom = edgeMetrics.distanceToBottom
  }

  private handleScrollFrame(): void {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

    if (!data || !container) {
      return
    }

    const metrics = this.readScrollFrameMetrics(container)
    const scrollSource = this.scrollIntent.classifyScroll(this.currentFrame)
    this.lastScrollSource = scrollSource
    this.updateActiveFollowBottomIntentForScroll(
      data,
      metrics.scrollTop,
      scrollSource,
    )
    if (this.lastDiagnosticScrollSource !== scrollSource) {
      this.lastDiagnosticScrollSource = scrollSource
      this.emitDiagnostic({
        channel: 'scroll',
        severity: 'debug',
        name: 'scroll.sourceChanged',
        details: () => ({
          source: scrollSource,
          scrollTop: metrics.scrollTop,
          distanceToBottom: metrics.distanceToBottom,
        }),
      })
    }
    const previousBottomLockState = this.scrollIntent.getBottomLockState()
    const changed = this.updateBottomLockForDataWindow(
      data,
      metrics.distanceToBottom,
      scrollSource,
    )

    if (changed) {
      const nextBottomLockState = this.scrollIntent.getBottomLockState()
      if (this.lastDiagnosticBottomLockState !== nextBottomLockState) {
        this.lastDiagnosticBottomLockState = nextBottomLockState
        this.emitDiagnostic({
          channel: 'scroll',
          severity: 'info',
          name: 'scroll.bottomLockChanged',
          details: () => ({
            previousBottomLockState,
            nextBottomLockState,
            source: scrollSource,
            distanceToBottom: metrics.distanceToBottom,
            hasMoreAfter: data.hasMoreAfter,
          }),
        })
      }
      this.projection.publish({
        data,
        renderWindow: this.keepCurrentWindow(data.items),
        bootstrapState: this.store.getSnapshot().bootstrapState,
        bottomLockState: this.scrollIntent.getBottomLockState(),
      })
    }

    this.edge.emitEdgeNeeds({
      data,
      metrics,
      scrollSource,
      lastUserScrollTop: this.lastUserScrollTop,
      lastUserDistanceToBottom: this.lastUserDistanceToBottom,
    })

    if (scrollSource === 'user') {
      this.updateScrollbarDragEdgeIntent(data, metrics)
      // 只有真实用户滚动能更新用户意图基线；runtime 写 scrollTop 不应影响 edge latch 释放。
      this.updatePendingFollowBottomForUserScroll(metrics.scrollTop)
      this.lastUserScrollTop = metrics.scrollTop
      this.lastUserDistanceToBottom = metrics.distanceToBottom
      this.scheduleViewportAnchorIdleEvent()
    }

    if (this.state === 'READY') {
      this.maybeSlideWindow(data, metrics)
    }
  }

  private updateScrollbarDragEdgeIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
  ): void {
    if (!this.scrollbarDragIntentActive) {
      return
    }

    const snapshot = this.store.getSnapshot()

    if (
      data.hasMoreBefore &&
      snapshot.renderWindow.startIndex === 0 &&
      metrics.scrollTop <= this.edgeLoadThresholdPx
    ) {
      this.scrollbarDragEdgeIntent = 'before'
      return
    }

    if (
      data.hasMoreAfter &&
      snapshot.renderWindow.endIndex >= data.items.length - 1 &&
      metrics.distanceToBottom <= this.edgeLoadThresholdPx
    ) {
      this.scrollbarDragEdgeIntent = 'after'
    }
  }

  private getScrollbarDragEdgeIntentMetrics(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
  ): ScrollFrameMetrics {
    if (this.scrollbarDragEdgeIntent === 'before' && data.hasMoreBefore) {
      return {
        ...metrics,
        scrollTop: 0,
        distanceToBottom: Math.max(0, metrics.scrollHeight - metrics.clientHeight),
      }
    }

    if (this.scrollbarDragEdgeIntent === 'after' && data.hasMoreAfter) {
      return {
        ...metrics,
        scrollTop: Math.max(0, metrics.scrollHeight - metrics.clientHeight),
        distanceToBottom: 0,
      }
    }

    return metrics
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

  private reconcileReadyBottomLockFromViewport(reason: string): boolean {
    const data = this.dataSnapshot

    if (!data || this.store.getSnapshot().bootstrapState !== 'READY') {
      return false
    }

    const changed = this.reconcileBottomLockFromViewport(data, reason)

    if (changed) {
      this.projection.publish({
        data,
        renderWindow: this.keepCurrentWindow(data.items),
        bootstrapState: this.store.getSnapshot().bootstrapState,
        bottomLockState: this.scrollIntent.getBottomLockState(),
      })
    }

    return changed
  }

  private reconcileBottomLockFromViewport(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    reason: string,
  ): boolean {
    const container = this.registry.getContainer()

    if (!container || data.hasMoreAfter) {
      return false
    }

    const metrics = this.readScrollFrameMetrics(container)
    const previousBottomLockState = this.scrollIntent.getBottomLockState()
    const changed = this.scrollIntent.reconcileBottomLockFromDistance(
      metrics.distanceToBottom,
    )

    if (changed) {
      this.lastDiagnosticBottomLockState = this.scrollIntent.getBottomLockState()
      this.emitDiagnostic({
        channel: 'scroll',
        severity: 'info',
        name: 'scroll.bottomLockReconciled',
        details: () => ({
          reason,
          previousBottomLockState,
          nextBottomLockState: this.scrollIntent.getBottomLockState(),
          scrollTop: metrics.scrollTop,
          scrollHeight: metrics.scrollHeight,
          clientHeight: metrics.clientHeight,
          distanceToBottom: metrics.distanceToBottom,
          hasMoreAfter: data.hasMoreAfter,
        }),
      })
    }

    return changed
  }

  private maybeSlideWindow(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    metrics: ScrollFrameMetrics,
  ): void {
    if (this.readySubstate === 'READY_MOTION_ACTIVE') {
      return
    }

    const snapshot = this.store.getSnapshot()
    const edgeThresholdPx = this.getEdgeThresholdPx(metrics)
    const nearTop = metrics.scrollTop < snapshot.topSpacer + edgeThresholdPx
    const nearBottom =
      metrics.distanceToBottom <
      snapshot.bottomSpacer + edgeThresholdPx

    if (!nearTop && !nearBottom) {
      return
    }

    const anchor = this.captureViewportAnchor()

    if (!anchor) {
      this.emitDiagnostic({
        channel: 'anchor',
        severity: 'warn',
        name: 'anchor.captureMissing',
        correlationId:
          `data:${data.feedId}:${data.generation}:${this.store.getSnapshot().revision}`,
        details: () => ({
          reason: 'window-slide',
          scrollTop: metrics.scrollTop,
          distanceToBottom: metrics.distanceToBottom,
          topSpacer: snapshot.topSpacer,
          bottomSpacer: snapshot.bottomSpacer,
        }),
      })
      return
    }

    const anchorIndex = this.renderWindow.findIndexByKey(data.items, anchor.key)

    if (anchorIndex < 0) {
      return
    }

    // window slide 围绕当前可见 anchor 重新裁剪，不改变阅读位置，只减少远端 DOM 压力。
    const nextWindow = this.renderWindow.computeWindowAroundAnchor({
      items: data.items,
      anchorIndex,
      viewportHeight: metrics.clientHeight,
      viewportWidth: metrics.clientWidth,
    })

    if (this.projection.isRenderWindowEqual(snapshot.renderWindow, nextWindow)) {
      return
    }

    this.transactions.enqueue(
      'resize',
      () =>
        this.transactionController.runWindowSlideTransaction(anchor, nextWindow, {
          feedId: data.feedId,
          generation: data.generation,
          revision: data.revision,
        }),
      'window-slide',
    )
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

    const totalDelta = deltas.reduce((total, delta) => total + delta.delta, 0)
    this.spacer.invalidateEstimateCache()

    if (this.motion.isActive()) {
      // motion 期间高度变化会改变目的地坐标，先取消再按当前 anchor/bottom lock 恢复。
      this.motion.cancel('resize-during-motion')
    }

    if (
      this.scrollIntent.getBottomLockState() === 'LOCKED' &&
      !data.hasMoreAfter
    ) {
      this.emitDiagnostic({
        channel: 'measurement',
        severity: 'info',
        name: 'measurement.heightStabilized',
        correlationId:
          `data:${data.feedId}:${data.generation}:${this.store.getSnapshot().revision}`,
        details: () => ({
          deltaCount: deltas.length,
          totalDelta,
          deltaAboveAnchor: null,
          anchorKey: null,
          bottomLockState: this.scrollIntent.getBottomLockState(),
          action: 'scroll-to-bottom',
        }),
      })
      this.motion.scrollToBottom('programmatic')
      this.emitViewportAnchorChanged('transaction-settle')
      return
    }

    const anchor = this.captureViewportAnchor()

    if (!anchor) {
      this.emitDiagnostic({
        channel: 'anchor',
        severity: 'warn',
        name: 'anchor.captureMissing',
        correlationId:
          `data:${data.feedId}:${data.generation}:${this.store.getSnapshot().revision}`,
        details: () => ({
          reason: 'height-stabilization',
          deltaCount: deltas.length,
          totalDelta,
        }),
      })
      return
    }

    const anchorIndex = this.renderWindow.findIndexByKey(data.items, anchor.key)
    // 只补偿 anchor 之前的高度变化；anchor 之后的内容变高不应推动当前阅读位置。
    const deltaAboveAnchor = deltas.reduce((total, delta) => {
      const deltaIndex = this.renderWindow.findIndexByKey(data.items, delta.key)
      return deltaIndex >= 0 && deltaIndex < anchorIndex ? total + delta.delta : total
    }, 0)

    this.emitDiagnostic({
      channel: 'measurement',
      severity: 'info',
      name: 'measurement.heightStabilized',
      correlationId:
        `data:${data.feedId}:${data.generation}:${this.store.getSnapshot().revision}`,
      details: () => ({
        deltaCount: deltas.length,
        totalDelta,
        deltaAboveAnchor,
        anchorKey: anchor.key,
        bottomLockState: this.scrollIntent.getBottomLockState(),
      }),
    })

    if (Math.abs(deltaAboveAnchor) > 0.5) {
      this.motion.writeScrollTop(container.scrollTop + deltaAboveAnchor, 'recovery')
    }

    this.emitViewportAnchorChanged('transaction-settle', anchor)
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

      if (!container || !data || this.store.getSnapshot().bootstrapState === 'INITIAL') {
        return
      }

      const previousSize = this.lastContainerSize ?? this.readContainerSize(container)
      const nextSize = this.readContainerSize(container)

      this.lastContainerSize = nextSize

      if (
        previousSize.width === nextSize.width &&
        previousSize.height === nextSize.height
      ) {
        return
      }

      this.transactions.enqueue(
        'resize',
        () =>
          this.transactionController.runContainerResizeTransaction(
            previousSize,
            nextSize,
          ),
        'resize',
      )
    })
  }

  private scheduleViewportAnchorIdleEvent(): void {
    if (this.anchorIdleTimer !== null) {
      this.scheduler.clearTimeout(this.anchorIdleTimer)
    }

    const token = this.lifecycle.getCurrent()
    this.anchorIdleTimer = this.scheduler.setTimeout(() => {
      this.anchorIdleTimer = null

      if (!this.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.emitViewportAnchorChanged('scroll-idle')
    }, VIEWPORT_ANCHOR_IDLE_MS)
  }

  private emitViewportAnchorChanged(
    reason: ViewportAnchorChangeReason,
    anchorOverride?: AnchorState | null,
  ): void {
    const data = this.dataSnapshot

    if (!data || this.state === 'DESTROYED') {
      return
    }

    const anchor =
      typeof anchorOverride === 'undefined'
        ? this.captureViewportAnchor()
        : anchorOverride

    this.emitEvent({
      type: 'viewportAnchorChanged',
      feedId: data.feedId,
      generation: data.generation,
      reason,
      anchor: anchor ? cloneAnchorState(anchor) : null,
    })

    if (reason === 'transaction-settle') {
      this.scheduleScrollbarDragEdgeRecheck('transaction-settle')
    }
  }

  private getEdgeThresholdPx(metrics: ScrollFrameMetrics): number {
    return metrics.clientHeight * this.config.overscan
  }

  private readScrollFrameMetrics(container: HTMLElement): ScrollFrameMetrics {
    const scrollTop = container.scrollTop
    const clientHeight = container.clientHeight
    const scrollHeight = container.scrollHeight

    return {
      scrollTop,
      clientHeight,
      clientWidth: container.clientWidth,
      scrollHeight,
      distanceToBottom: Math.max(0, scrollHeight - scrollTop - clientHeight),
    }
  }

  private isScrollbarDragScrollEvent(event: Event): boolean {
    return this.scrollbarDragIntentActive && (event.isTrusted || event instanceof UIEvent)
  }

  private isLikelyScrollbarPointerEvent(event: MouseEvent | PointerEvent): boolean {
    const container = this.registry.getContainer()

    if (!container || event.target !== container) {
      return false
    }

    const rect = container.getBoundingClientRect()
    const verticalScrollbarWidth = container.offsetWidth - container.clientWidth

    if (verticalScrollbarWidth <= 0) {
      return true
    }

    return event.clientX >= rect.right - verticalScrollbarWidth - 2
  }

  private readContainerSize(container: HTMLElement): ContainerSize {
    return {
      width: container.clientWidth,
      height: container.clientHeight,
    }
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
        // 图片等异步内容继续撑高 scrollHeight 时，吸底 bootstrap 需要跨稳定帧追到底。
        this.motion.scrollToBottom('followBottom')
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

    if (this.anchorIdleTimer !== null) {
      this.scheduler.clearTimeout(this.anchorIdleTimer)
      this.anchorIdleTimer = null
    }
  }

  private emitEvent(event: MessageViewportRuntimeEvent): void {
    if (event.type !== 'viewportDiagnostic') {
      this.emitEventDiagnostic(event)
    }

    for (const listener of this.eventListeners) {
      listener(event)
    }
  }

  private emitEventDiagnostic(event: MessageViewportRuntimeEvent): void {
    switch (event.type) {
      case 'needMoreBefore':
      case 'needMoreAfter':
      case 'needLatestMessages':
      case 'needMessagesAround':
        this.emitDiagnostic({
          channel: 'edge',
          severity: 'info',
          name: `event.${event.type}`,
          details: () => ({
            event,
          }),
        })
        break
      case 'viewportReady':
        this.emitDiagnostic({
          channel: 'lifecycle',
          severity: 'info',
          name: 'event.viewportReady',
          details: () => ({
            event,
          }),
        })
        break
      case 'viewportError':
      case 'viewportAnchorChanged':
        break
    }
  }

  private emitDiagnostic(input: RuntimeDiagnosticInput): void {
    if (this.state === 'DESTROYED') {
      return
    }

    this.diagnostics.emit(input)
  }

  private getDiagnosticContext(): {
    feedId: string
    generation: number
    state: RuntimeState
    readySubstate: ReadySubstate
    pendingCommands: number
  } {
    const data = this.dataSnapshot
    const token = data
      ? { feedId: data.feedId, generation: data.generation }
      : this.lifecycle.getCurrent()

    return {
      feedId: token.feedId,
      generation: token.generation,
      state: this.state,
      readySubstate: this.readySubstate,
      pendingCommands: this.transactions.getPendingCount(),
    }
  }

  private emitError(code: string): void {
    const token = this.lifecycle.getCurrent()
    this.emitDiagnostic({
      channel: 'recovery',
      severity: 'error',
      name: 'runtime.error',
      details: () => ({
        code,
        token,
      }),
    })
    this.emitEvent({
      type: 'viewportError',
      feedId: token.feedId,
      generation: token.generation,
      code,
    })
  }
}
