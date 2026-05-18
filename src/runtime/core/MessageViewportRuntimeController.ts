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
import { ResizeStabilizationCoordinator } from './resizeStabilizationCoordinator'
import { DestinationIntentCoordinator } from './destinationIntentCoordinator'
import { RuntimeStateAxes } from './runtimeStateAxes'
import { RuntimeCommandRouter } from './runtimeCommandRouter'
import { RuntimeLifecycleCoordinator } from './runtimeLifecycleCoordinator'
import {
  readScrollFrameMetrics,
  ScrollFrameCoordinator,
} from './scrollFrameCoordinator'
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
  VIEWPORT_ANCHOR_IDLE_MS,
  cloneAnchorState,
  type BootstrapCommand,
  type CommitRecoveryInput,
  type ContainerSize,
  type DestinationMotionForcedStart,
  type ReadySubstate,
  type ScrollFrameMetrics,
} from './runtimeTypes'
import { AnchorCoordinator } from '../dom/anchorCoordinator'
import { EdgeNeedCoordinator } from '../events/edgeNeedCoordinator'
import { DestinationMotionCoordinator } from '../scroll/destinationMotionCoordinator'
import { ViewportTransactionController } from '../transactions/viewportTransactionController'
import {
  CUSTOM_SCROLLBAR_DRAG_END_EVENT,
  CUSTOM_SCROLLBAR_DRAG_SCROLL_EVENT,
  CUSTOM_SCROLLBAR_DRAG_START_EVENT,
} from '../scroll/customScrollbarEvents'
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
  TransactionState,
  DestinationState,
  ViewportPhase,
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

  private readonly resizeStabilization: ResizeStabilizationCoordinator<
    TMessage,
    TOptimistic
  >

  private readonly scrollFrame: ScrollFrameCoordinator<TMessage, TOptimistic>

  private readonly destinationIntent: DestinationIntentCoordinator<
    TMessage,
    TOptimistic
  >

  private readonly commandRouter: RuntimeCommandRouter<TMessage, TOptimistic>

  private readonly runtimeLifecycle: RuntimeLifecycleCoordinator<
    TMessage,
    TOptimistic
  >

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

  private readonly stateAxes = new RuntimeStateAxes()

  private state: RuntimeState = 'INITIAL'

  private activeTransactionKind: ViewportTransactionKind | null = null

  private dataSnapshot: MessageDataSnapshot<TMessage, TOptimistic> | null = null

  private pendingBootstrap: BootstrapCommand | null = null

  private anchorIdleTimer: number | null = null

  private currentFrame = 0

  private lastScrollSource: ScrollSource | null = null

  private lastDiagnosticScrollSource: ScrollSource | null = null

  private lastUserScrollTop = 0

  private lastUserDistanceToBottom = 0

  private retainedScrollTop: number | null = null

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

    this.scrollFrame.scheduleScrollRaf()
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

  private readonly handleCustomScrollbarDragStart = (): void => {
    this.scrollbarDragIntentActive = true
    this.scrollIntent.markUserIntent(this.currentFrame)
    this.handleUserScrollIntent()
  }

  private readonly handleCustomScrollbarDragScroll = (): void => {
    this.scrollbarDragIntentActive = true
    this.scrollIntent.markUserIntent(this.currentFrame)
    this.scrollFrame.scheduleScrollRaf()
  }

  private readonly handleCustomScrollbarDragEnd = (): void => {
    this.handleScrollbarDragEnd()
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
      () => this.resizeStabilization.scheduleHeightStabilization(),
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
      () => this.destinationIntent.hasPendingFollowBottom(),
      (event) => this.emitEvent(event),
    )
    this.destinationIntent = new DestinationIntentCoordinator({
      lifecycle: this.lifecycle,
      renderWindow: this.renderWindow,
      scrollIntent: this.scrollIntent,
      edge: this.edge,
      getDataSnapshot: () => this.dataSnapshot,
      getScrollTop: () => this.registry.getContainer()?.scrollTop ?? 0,
      setReadySubstate: (substate) =>
        this.stateAxes.setReadySubstate(substate),
      getReadySubstate: () => this.stateAxes.getReadySubstate(),
      setDestinationState: (state) => {
        this.stateAxes.setDestinationState(state)
      },
      getDestinationState: () => this.stateAxes.getDestinationState(),
      enqueueFollowBottomTransaction: () => this.enqueueFollowBottomTransaction(),
      enqueueJumpTransaction: (target, options) =>
        this.enqueueJumpTransaction(target, options),
      enqueueRestoreTransaction: (target) =>
        this.enqueueRestoreTransaction(target),
      emitEvent: (event) => this.emitEvent(event),
      emitDiagnostic: (input) => this.emitDiagnostic(input),
    })
    this.commandRouter = new RuntimeCommandRouter({
      getState: () => this.state,
      stateAxes: this.stateAxes,
      destinationIntent: this.destinationIntent,
      setPendingBootstrap: (command) => {
        this.pendingBootstrap = command
      },
      tryRunPendingBootstrap: () => this.tryRunPendingBootstrap(),
      enqueueResetTransaction: (reason) => this.enqueueResetTransaction(reason),
      emitDiagnostic: (input) => this.emitDiagnostic(input),
    })
    this.motion = new DestinationMotionCoordinator(
      this.registry,
      this.store,
      this.scheduler,
      this.scrollIntent,
      this.projection,
      this.scrollMotionOptions,
      (substate) => this.stateAxes.setReadySubstate(substate),
      (state) => this.stateAxes.setDestinationState(state),
      () => this.currentFrame,
      () => this.state === 'DESTROYED',
      (reason) => this.emitViewportAnchorChanged(reason),
      (settle) => this.destinationIntent.handleDestinationMotionSettle(settle),
      (settle, context) =>
        this.destinationIntent.handleDestinationMotionSupersede(settle, context),
      (scrollTop, source) =>
        this.destinationIntent.recordActiveFollowBottomIntentScrollWrite(
          scrollTop,
          source,
        ),
      (input) => this.emitDiagnostic(input),
    )
    this.transactions = new TransactionRunner({
      onEnqueue: (kind, id) =>
        this.handleTransactionEnqueue(kind, id),
      onStart: (kind, id) => {
        this.handleTransactionStart(kind, id)
        this.motion.cancel('transaction-supersede', {
          transactionKind: kind,
          transactionId: id,
        })
      },
      onComplete: (kind, id) => this.handleTransactionComplete(kind, id),
      onDrop: (kind, id, reason) =>
        this.handleTransactionDrop(kind, id, reason),
      onError: (kind, id, error) =>
        this.handleTransactionError(kind, id, error),
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
      setViewportPhase: (phase) => {
        this.stateAxes.setViewportPhase(phase)
      },
      setTransactionState: (state) => {
        this.stateAxes.setTransactionState(state)
      },
      setDestinationState: (state) => {
        this.stateAxes.setDestinationState(state)
      },
      setPendingBootstrap: (command) => {
        this.pendingBootstrap = command
      },
      tryRunPendingBootstrap: () => this.tryRunPendingBootstrap(),
      startPendingFollowBottom: (data, scrollTop) =>
        this.destinationIntent.startPendingFollowBottom(data, scrollTop),
      hasActiveFollowBottomIntent: (data) =>
        this.destinationIntent.hasActiveFollowBottomIntent(data),
      clearActiveFollowBottomIntent: (reason) =>
        this.destinationIntent.clearActiveFollowBottomIntent(reason),
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
      emitDestinationSettled: (event) =>
        this.destinationIntent.emitDestinationSettled(event),
      invalidateSpacerCache: () => this.spacer.invalidateEstimateCache(),
      emitEvent: (event) => this.emitEvent(event),
      emitDiagnostic: (input) => this.emitDiagnostic(input),
      emitError: (code) => this.emitError(code),
    })
    this.scrollFrame = new ScrollFrameCoordinator({
      scheduler: this.scheduler,
      registry: this.registry,
      lifecycle: this.lifecycle,
      store: this.store,
      scrollIntent: this.scrollIntent,
      projection: this.projection,
      edge: this.edge,
      anchor: this.anchor,
      renderWindow: this.renderWindow,
      transactions: this.transactions,
      transactionController: this.transactionController,
      getDataSnapshot: () => this.dataSnapshot,
      getCurrentFrame: () => this.currentFrame,
      setCurrentFrame: (frame) => {
        this.currentFrame = frame
      },
      getState: () => this.state,
      getReadySubstate: () => this.stateAxes.getReadySubstate(),
      getScrollbarDragIntentActive: () => this.scrollbarDragIntentActive,
      getScrollbarDragEdgeIntent: () => this.scrollbarDragEdgeIntent,
      setScrollbarDragEdgeIntent: (edge) => {
        this.scrollbarDragEdgeIntent = edge
      },
      getLastUserScrollTop: () => this.lastUserScrollTop,
      setLastUserScrollTop: (scrollTop) => {
        this.lastUserScrollTop = scrollTop
      },
      getLastUserDistanceToBottom: () => this.lastUserDistanceToBottom,
      setLastUserDistanceToBottom: (distance) => {
        this.lastUserDistanceToBottom = distance
      },
      getLastDiagnosticScrollSource: () => this.lastDiagnosticScrollSource,
      setLastDiagnosticScrollSource: (source) => {
        this.lastDiagnosticScrollSource = source
      },
      setLastScrollSource: (source) => {
        this.lastScrollSource = source
      },
      getEdgeLoadThresholdPx: () => this.edgeLoadThresholdPx,
      updatePendingFollowBottomForUserScroll: (scrollTop) =>
        this.destinationIntent.updatePendingFollowBottomForUserScroll(scrollTop),
      updateActiveFollowBottomIntentForScroll: (data, scrollTop, source) =>
        this.destinationIntent.updateActiveFollowBottomIntentForScroll(
          data,
          scrollTop,
          source,
        ),
      scheduleViewportAnchorIdleEvent: () => this.scheduleViewportAnchorIdleEvent(),
      runAnchorlessWindowSlideTransaction: (nextWindow, expectedData) =>
        this.runAnchorlessWindowSlideTransaction(nextWindow, expectedData),
      emitViewportAnchorChanged: (reason, anchor) =>
        this.emitViewportAnchorChanged(reason, anchor),
      emitDiagnostic: (input) => this.emitDiagnostic(input),
      getEdgeThresholdPx: (metrics) => this.getEdgeThresholdPx(metrics),
    })
    this.resizeStabilization = new ResizeStabilizationCoordinator({
      scheduler: this.scheduler,
      observerFactory: this.observerFactory,
      registry: this.registry,
      lifecycle: this.lifecycle,
      store: this.store,
      measurement: this.measurement,
      spacer: this.spacer,
      motion: this.motion,
      scrollIntent: this.scrollIntent,
      renderWindow: this.renderWindow,
      transactions: this.transactions,
      transactionController: this.transactionController,
      getDataSnapshot: () => this.dataSnapshot,
      getCurrentFrame: () => this.currentFrame,
      setCurrentFrame: (frame) => {
        this.currentFrame = frame
      },
      getLastContainerSize: () => this.lastContainerSize,
      setLastContainerSize: (size) => {
        this.lastContainerSize = size
      },
      captureViewportAnchor: () => this.captureViewportAnchor(),
      emitViewportAnchorChanged: (reason, anchor) =>
        this.emitViewportAnchorChanged(reason, anchor),
      emitDiagnostic: (input) => this.emitDiagnostic(input),
    })
    this.runtimeLifecycle = new RuntimeLifecycleCoordinator({
      registry: this.registry,
      store: this.store,
      lifecycle: this.lifecycle,
      transactions: this.transactions,
      commit: this.commit,
      resizeStabilization: this.resizeStabilization,
      edge: this.edge,
      measurement: this.measurement,
      motion: this.motion,
      scrollIntent: this.scrollIntent,
      renderWindow: this.renderWindow,
      spacer: this.spacer,
      destinationIntent: this.destinationIntent,
      stateAxes: this.stateAxes,
      heightCache: this.heightCache,
      eventListeners: this.eventListeners,
      getState: () => this.state,
      setState: (state) => {
        this.state = state
      },
      getCurrentFrame: () => this.currentFrame,
      getRetainedScrollTop: () => this.retainedScrollTop,
      setRetainedScrollTop: (scrollTop) => {
        this.retainedScrollTop = scrollTop
      },
      setLastScrollSource: (source) => {
        this.lastScrollSource = source
      },
      setLastUserScrollTop: (scrollTop) => {
        this.lastUserScrollTop = scrollTop
      },
      setLastUserDistanceToBottom: (distance) => {
        this.lastUserDistanceToBottom = distance
      },
      setLastContainerSize: (size) => {
        this.lastContainerSize = size
      },
      attachDomListeners: (container) => this.attachDomListeners(container),
      detachDomListeners: (container) => this.detachDomListeners(container),
      cancelScheduledWork: () => this.cancelScheduledWork(),
      readContainerSize: (container) => this.readContainerSize(container),
      reconcileReadyBottomLockFromViewport: (reason) =>
        this.reconcileReadyBottomLockFromViewport(reason),
      tryRunPendingBootstrap: () => this.tryRunPendingBootstrap(),
      emitViewportAnchorChanged: (reason) =>
        this.emitViewportAnchorChanged(reason),
      emitDiagnostic: (input) => this.emitDiagnostic(input),
    })
  }

  attach(container: HTMLElement): void {
    this.runtimeLifecycle.attach(container)
  }

  detach(): void {
    this.runtimeLifecycle.detach()
  }

  destroy(): void {
    this.runtimeLifecycle.destroy()
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

    if (this.destinationIntent.drivePendingFollowBottom(snapshot)) {
      return
    }

    if (this.destinationIntent.drivePendingDestinationRequest(snapshot)) {
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
    this.commandRouter.dispatch(command)
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
    viewportPhase: ViewportPhase
    transactionState: TransactionState
    destinationState: DestinationState
    pendingCommands: number
    motionActive: boolean
    observedRows: number
    heightCacheSize: number
    lastScrollSource: ScrollSource | null
  } {
    return {
      state: this.state,
      readySubstate: this.stateAxes.getReadySubstate(),
      viewportPhase: this.stateAxes.getViewportPhase(),
      transactionState: this.stateAxes.getTransactionState(),
      destinationState: this.stateAxes.getDestinationState(),
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

  private canEmitEdgeNeeds(): boolean {
    const snapshot = this.store.getSnapshot()

    return (
      this.state === 'READY' &&
      this.stateAxes.getReadySubstate() === 'READY_IDLE' &&
      snapshot.bootstrapState === 'READY'
    )
  }

  private resetForGeneration(feedId: string, generation: number): void {
    this.runtimeLifecycle.resetForGeneration(feedId, generation)
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

  private enqueueJumpTransaction(
    target: MessageIdentityAnchor,
    options: {
      forceAnimateFrom?: DestinationMotionForcedStart
      allowPreposition?: boolean
      animate?: boolean
      originalTarget?: MessageIdentityAnchor
    } = {},
  ): void {
    this.transactions.enqueue(
      'jump',
      () => this.transactionController.runJumpTransaction(target, options),
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

  private handleTransactionEnqueue(kind: ViewportTransactionKind, id: string): void {
    this.stateAxes.setTransactionState(
      this.transactions.getPendingCount() > 1 ? 'queued' : 'active',
    )
    this.emitTransactionDiagnostic('enqueue', kind, id)
  }

  private handleTransactionStart(kind: ViewportTransactionKind, id: string): void {
    this.activeTransactionKind = kind
    this.stateAxes.setTransactionState('active')
    this.emitTransactionDiagnostic('start', kind, id)
  }

  private handleTransactionComplete(
    kind: ViewportTransactionKind,
    id: string,
  ): void {
    this.stateAxes.setTransactionState(
      this.transactions.getPendingCount() > 0 ? 'queued' : 'idle',
    )
    this.emitTransactionDiagnostic('complete', kind, id)
    this.activeTransactionKind = null
  }

  private handleTransactionDrop(
    kind: ViewportTransactionKind,
    id: string,
    reason: 'reset-supersede' | 'key-supersede' | 'clear' | 'stop',
  ): void {
    this.stateAxes.setTransactionState(
      this.transactions.getPendingCount() > 0 ? 'queued' : 'idle',
    )
    this.emitTransactionDiagnostic('drop', kind, id, { reason })
    this.activeTransactionKind = null
  }

  private handleTransactionError(
    kind: ViewportTransactionKind,
    id: string,
    error: unknown,
  ): void {
    this.stateAxes.setTransactionState(
      this.transactions.getPendingCount() > 0 ? 'queued' : 'idle',
    )
    this.emitTransactionDiagnostic('error', kind, id, {
      error: error instanceof Error ? error.message : String(error),
    })
    this.activeTransactionKind = null
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

  private scheduleScrollbarDragEdgeRecheck(reason: string): void {
    this.scrollFrame.scheduleScrollbarDragEdgeRecheck(reason)
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

    const metrics = readScrollFrameMetrics(container)
    const previousBottomLockState = this.scrollIntent.getBottomLockState()
    const changed = this.scrollIntent.reconcileBottomLockFromDistance(
      metrics.distanceToBottom,
    )

    if (changed) {
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

  private async runAnchorlessWindowSlideTransaction(
    nextWindow: RenderWindow,
    expectedData: { feedId: string; generation: number; revision: number },
  ): Promise<void> {
    const data = this.dataSnapshot
    const container = this.registry.getContainer()

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

    const token = this.lifecycle.getCurrent()
    const previousSnapshot = this.store.getSnapshot()
    const previousBottomLockState = this.scrollIntent.getBottomLockState()
    this.stateAxes.setViewportPhase('PROJECTING')

    try {
      const projection = this.projection.publish({
        data,
        renderWindow: nextWindow,
        bootstrapState: previousSnapshot.bootstrapState,
        bottomLockState: previousBottomLockState,
        viewportPhase: 'PROJECTING',
      })

      await this.commit.waitForChanged(projection, 'resize')
      this.measureCurrentWindow()
      this.stateAxes.setViewportPhase('IDLE')
      this.projection.publish({
        data,
        renderWindow: nextWindow,
        bootstrapState: previousSnapshot.bootstrapState,
        bottomLockState: this.scrollIntent.getBottomLockState(),
        viewportPhase: 'IDLE',
      })
      this.emitViewportAnchorChanged(
        'transaction-settle',
        this.captureViewportAnchor(),
      )
    } catch (error) {
      this.recoverAfterCommitFailure({
        token,
        nextState: 'READY',
        restoreBottomLockState: previousBottomLockState,
        restoreSnapshot: previousSnapshot,
      })
      throw error
    }
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

    if (
      reason === 'transaction-settle' &&
      (this.activeTransactionKind === 'prepend' ||
        this.activeTransactionKind === 'append')
    ) {
      this.scheduleScrollbarDragEdgeRecheck(
        `transaction-settle:${this.activeTransactionKind}`,
      )
    }
  }

  private getEdgeThresholdPx(metrics: ScrollFrameMetrics): number {
    return metrics.clientHeight * this.config.overscan
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

  private attachDomListeners(container: HTMLElement): void {
    container.addEventListener('scroll', this.handleScroll, { passive: true })
    container.addEventListener('wheel', this.handleUserScrollIntent, { passive: true })
    container.addEventListener('touchstart', this.handleUserScrollIntent, {
      passive: true,
    })
    container.addEventListener('pointerdown', this.handlePointerScrollIntent)
    container.addEventListener('mousedown', this.handleMouseScrollIntent)
    container.addEventListener('keydown', this.handleUserScrollIntent)
    container.addEventListener(
      CUSTOM_SCROLLBAR_DRAG_START_EVENT,
      this.handleCustomScrollbarDragStart as EventListener,
    )
    container.addEventListener(
      CUSTOM_SCROLLBAR_DRAG_SCROLL_EVENT,
      this.handleCustomScrollbarDragScroll as EventListener,
    )
    container.addEventListener(
      CUSTOM_SCROLLBAR_DRAG_END_EVENT,
      this.handleCustomScrollbarDragEnd as EventListener,
    )
    window.addEventListener('pointerup', this.handleScrollbarDragEnd)
    window.addEventListener('mouseup', this.handleScrollbarDragEnd)
    window.addEventListener('blur', this.handleScrollbarDragEnd)
  }

  private detachDomListeners(container: HTMLElement): void {
    container.removeEventListener('scroll', this.handleScroll)
    container.removeEventListener('wheel', this.handleUserScrollIntent)
    container.removeEventListener('touchstart', this.handleUserScrollIntent)
    container.removeEventListener('pointerdown', this.handlePointerScrollIntent)
    container.removeEventListener('mousedown', this.handleMouseScrollIntent)
    container.removeEventListener('keydown', this.handleUserScrollIntent)
    container.removeEventListener(
      CUSTOM_SCROLLBAR_DRAG_START_EVENT,
      this.handleCustomScrollbarDragStart as EventListener,
    )
    container.removeEventListener(
      CUSTOM_SCROLLBAR_DRAG_SCROLL_EVENT,
      this.handleCustomScrollbarDragScroll as EventListener,
    )
    container.removeEventListener(
      CUSTOM_SCROLLBAR_DRAG_END_EVENT,
      this.handleCustomScrollbarDragEnd as EventListener,
    )
    window.removeEventListener('pointerup', this.handleScrollbarDragEnd)
    window.removeEventListener('mouseup', this.handleScrollbarDragEnd)
    window.removeEventListener('blur', this.handleScrollbarDragEnd)
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
    this.scrollFrame.cancelScheduledWork()
    this.resizeStabilization.cancelScheduledWork()

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
      case 'destinationSettled':
        this.emitDiagnostic({
          channel: 'lifecycle',
          severity: 'info',
          name: `event.${event.type}`,
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
    viewportPhase: ViewportPhase
    transactionState: TransactionState
    destinationState: DestinationState
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
      readySubstate: this.stateAxes.getReadySubstate(),
      viewportPhase: this.stateAxes.getViewportPhase(),
      transactionState: this.stateAxes.getTransactionState(),
      destinationState: this.stateAxes.getDestinationState(),
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
