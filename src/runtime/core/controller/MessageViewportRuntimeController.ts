import { DomRegistry } from '../../dom/domRegistry'
import { LifecycleGuard } from '../state/lifecycleGuard'
import { MeasurementEngine, type HeightDelta } from '../../dom/measurementEngine'
import { ProjectionStore } from '../state/projectionStore'
import { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { HeightCache } from '../../window/spacerEngine'
import { TransactionRunner } from '../../transactions/transactionRunner'
import { CommitCoordinator } from '../projection/commitCoordinator'
import { ResizeStabilizationCoordinator } from '../viewport/resizeStabilizationCoordinator'
import { RuntimeStateAxes } from '../state/runtimeStateAxes'
import { RuntimeCommandRouter } from '../commands/runtimeCommandRouter'
import { RuntimeLifecycleCoordinator } from '../viewport/runtimeLifecycleCoordinator'
import { RuntimeDomInputCoordinator } from '../input/runtimeDomInputCoordinator'
import { RuntimeEventHub } from '../events/runtimeEventHub'
import { RuntimeDataSnapshotCoordinator } from '../data/runtimeDataSnapshotCoordinator'
import { RuntimeRecoveryAndMeasurement } from '../recovery/runtimeRecoveryAndMeasurement'
import { ScrollFrameCoordinator } from '../viewport/scrollFrameCoordinator'
import { createRuntimeControllerServices } from './runtimeControllerComposition'
import { RuntimeViewportAnchorEvents } from './runtimeViewportAnchorEvents'
import {
  DiagnosticRecorder,
  type RuntimeDiagnosticInput,
} from '../../debug/diagnosticRecorder'
import {
  cloneAnchorState,
  type BootstrapCommand,
  type CommitRecoveryInput,
  type ContainerSize,
  type DestinationMotionForcedStart,
  type ReadySubstate,
} from '../state/runtimeTypes'
import { AnchorCoordinator } from '../../dom/anchorCoordinator'
import { EdgeNeedCoordinator } from '../../events/edgeNeedCoordinator'
import { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import { ViewportTransactionController } from '../../transactions/viewportTransactionController'
import type {
  AnchorState,
  DirectScrollInput,
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
  RuntimeState,
  ScrollSource,
  TransactionState,
  DestinationState,
  ViewportPhase,
  ViewportAnchorChangeReason,
  ViewportDiagnosticRecord,
} from '../../types'

/**
 * MessageViewportRuntimeController 是独立于 React 的 IM viewport engine 实现体。
 * 它拥有滚动语义、DOM 测量、anchor 稳定和 transaction；React 只能订阅 projection。
 */
export class MessageViewportRuntimeController<
  TMessage = unknown,
  TOptimistic = unknown,
> {
  private readonly heightCache: HeightCache = new Map()

  private readonly store: ProjectionStore<TMessage, TOptimistic>

  private readonly registry = new DomRegistry()

  private readonly lifecycle: LifecycleGuard

  private readonly renderWindow: RenderWindowEngine

  private readonly measurement: MeasurementEngine

  private readonly resizeStabilization: ResizeStabilizationCoordinator<
    TMessage,
    TOptimistic
  >

  private readonly scrollFrame: ScrollFrameCoordinator<TMessage, TOptimistic>

  private readonly domInput: RuntimeDomInputCoordinator<TMessage, TOptimistic>

  private readonly commandRouter: RuntimeCommandRouter<TMessage, TOptimistic>

  private readonly runtimeLifecycle: RuntimeLifecycleCoordinator<
    TMessage,
    TOptimistic
  >

  private readonly commit: CommitCoordinator<TMessage, TOptimistic>

  private readonly anchor: AnchorCoordinator<TMessage, TOptimistic>

  private readonly edge: EdgeNeedCoordinator<TMessage, TOptimistic>

  private readonly motion: DestinationMotionCoordinator<TMessage, TOptimistic>

  private readonly transactions: TransactionRunner

  private readonly transactionController: ViewportTransactionController<
    TMessage,
    TOptimistic
  >

  private readonly dataSnapshotCoordinator: RuntimeDataSnapshotCoordinator<
    TMessage,
    TOptimistic
  >

  private readonly recovery: RuntimeRecoveryAndMeasurement<TMessage, TOptimistic>

  private readonly anchorEvents: RuntimeViewportAnchorEvents<TMessage, TOptimistic>

  private readonly eventListeners = new Set<RuntimeEventListener>()

  private readonly eventHub: RuntimeEventHub

  private readonly diagnostics: DiagnosticRecorder

  private readonly stateAxes = new RuntimeStateAxes()

  private state: RuntimeState = 'INITIAL'

  private dataSnapshot: MessageDataSnapshot<TMessage, TOptimistic> | null = null

  private pendingBootstrap: BootstrapCommand | null = null

  private currentFrame = 0

  private lastScrollSource: ScrollSource | null = null

  private lastDiagnosticScrollSource: ScrollSource | null = null

  private lastUserScrollTop = 0

  private lastUserDistanceToBottom = 0

  private retainedScrollTop: number | null = null

  private lastContainerSize: ContainerSize | null = null

  private scrollbarDragIntentActive = false

  private scrollbarDragEdgeIntent: 'before' | 'after' | null = null

  constructor(options: MessageViewportRuntimeOptions = {}) {
    const services = createRuntimeControllerServices<TMessage, TOptimistic>(
      options,
      {
        stateAxes: this.stateAxes,
        heightCache: this.heightCache,
        eventListeners: this.eventListeners,
        getState: () => this.state,
        setState: (state) => { this.state = state },
        getDataSnapshot: () => this.dataSnapshot,
        setDataSnapshot: (snapshot) => { this.dataSnapshot = snapshot },
        setPendingBootstrap: (command) => { this.pendingBootstrap = command },
        getCurrentFrame: () => this.currentFrame,
        setCurrentFrame: (frame) => { this.currentFrame = frame },
        getRetainedScrollTop: () => this.retainedScrollTop,
        setRetainedScrollTop: (scrollTop) => { this.retainedScrollTop = scrollTop },
        getLastScrollSource: () => this.lastScrollSource,
        setLastScrollSource: (source) => { this.lastScrollSource = source },
        getLastDiagnosticScrollSource: () => this.lastDiagnosticScrollSource,
        setLastDiagnosticScrollSource: (source) => {
          this.lastDiagnosticScrollSource = source
        },
        getLastUserScrollTop: () => this.lastUserScrollTop,
        setLastUserScrollTop: (scrollTop) => { this.lastUserScrollTop = scrollTop },
        getLastUserDistanceToBottom: () => this.lastUserDistanceToBottom,
        setLastUserDistanceToBottom: (distance) => {
          this.lastUserDistanceToBottom = distance
        },
        getLastContainerSize: () => this.lastContainerSize,
        setLastContainerSize: (size) => { this.lastContainerSize = size },
        getScrollbarDragIntentActive: () => this.scrollbarDragIntentActive,
        setScrollbarDragIntentActive: (active) => {
          this.scrollbarDragIntentActive = active
        },
        getScrollbarDragEdgeIntent: () => this.scrollbarDragEdgeIntent,
        setScrollbarDragEdgeIntent: (edge) => {
          this.scrollbarDragEdgeIntent = edge
        },
        canEmitEdgeNeeds: () => this.canEmitEdgeNeeds(),
        tryRunPendingBootstrap: () => this.tryRunPendingBootstrap(),
        enqueuePrependTransaction: () => this.enqueuePrependTransaction(),
        enqueueAppendTransaction: (effect) => this.enqueueAppendTransaction(effect),
        enqueueProjectionRefresh: () => this.enqueueProjectionRefresh(),
        enqueueJumpTransaction: (target, jumpOptions) =>
          this.enqueueJumpTransaction(target, jumpOptions),
        enqueueRestoreTransaction: (target) =>
          this.enqueueRestoreTransaction(target),
        enqueueViewportCompactionTransaction: (target) =>
          this.enqueueViewportCompactionTransaction(target),
        enqueueRemoveFromStartTransaction: () => this.transactions.enqueue(
          'removeFromStart',
          () => this.transactionController.runRemoveFromStartTransaction(),
          'remove-from-start',
        ),
        enqueueItemLocationTransaction: () =>
          this.transactions.enqueue(
            'itemLocation',
            () => this.transactionController.runItemLocationTransaction(),
            'item-location',
          ),
        enqueueIdentityRebindTransaction: () =>
          this.transactions.enqueue(
            'identityRebind',
            () => this.transactionController.runIdentityRebindTransaction(),
            'identity-rebind',
          ),
        enqueueAnchorRiskTransaction: () =>
          this.transactions.enqueue(
            'anchorRisk',
            () => this.transactionController.runAnchorRiskTransaction(),
            'anchor-risk',
          ),
        enqueueResetTransaction: (reason) => this.enqueueResetTransaction(reason),
        enqueueFollowBottomTransaction: () => this.enqueueFollowBottomTransaction(),
        keepCurrentWindow: (items) => this.keepCurrentWindow(items),
        measureCurrentWindow: () => this.measureCurrentWindow(),
        recoverAfterCommitFailure: (input) => this.recoverAfterCommitFailure(input),
        deriveRuntimeStateFromSnapshot: (snapshot) =>
          this.deriveRuntimeStateFromSnapshot(snapshot),
        captureViewportAnchor: () => this.captureViewportAnchor(),
        readContainerSize: (container) => this.readContainerSize(container),
        attachDomListeners: (container) => this.attachDomListeners(container),
        detachDomListeners: (container) => this.detachDomListeners(container),
        cancelScheduledWork: () => this.cancelScheduledWork(),
        emitViewportAnchorChanged: (reason, anchor) =>
          this.emitViewportAnchorChanged(reason, anchor),
        getDiagnosticContext: () => this.getDiagnosticContext(),
        emitEvent: (event) => this.emitEvent(event),
        emitDiagnostic: (input) => this.emitDiagnostic(input),
        emitError: (code) => this.emitError(code),
      },
    )

    this.store = services.store
    this.registry = services.registry
    this.lifecycle = services.lifecycle
    this.renderWindow = services.renderWindow
    this.measurement = services.measurement
    this.resizeStabilization = services.resizeStabilization
    this.scrollFrame = services.scrollFrame
    this.domInput = services.domInput
    this.commandRouter = services.commandRouter
    this.runtimeLifecycle = services.runtimeLifecycle
    this.commit = services.commit
    this.anchor = services.anchor
    this.edge = services.edge
    this.motion = services.motion
    this.transactions = services.transactions
    this.transactionController = services.transactionController
    this.dataSnapshotCoordinator = services.dataSnapshotCoordinator
    this.recovery = services.recovery
    this.anchorEvents = services.anchorEvents
    this.eventHub = services.eventHub
    this.diagnostics = services.diagnostics
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
    this.dataSnapshotCoordinator.setDataSnapshot(snapshot)
  }

  dispatch(command: MessageRuntimeCommand): void {
    this.commandRouter.dispatch(command)
  }

  beginDirectScroll(input: DirectScrollInput): void {
    this.domInput.beginDirectScroll(input)
  }

  writeDirectScrollTop(scrollTop: number, input: DirectScrollInput): boolean {
    return this.domInput.writeDirectScrollTop(scrollTop, input)
  }

  endDirectScroll(input: DirectScrollInput): void {
    this.domInput.endDirectScroll(input)
  }

  subscribe(listener: RuntimeListener): () => void {
    return this.store.subscribe(listener)
  }

  subscribeEvent(listener: RuntimeEventListener): () => void {
    return this.eventHub.subscribeEvent(listener)
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

  private enqueuePrependTransaction(): void {
    this.transactions.enqueue(
      'prepend',
      () => this.transactionController.runPrependTransaction(),
      'prepend',
    )
  }

  private enqueueAppendTransaction(effect: 'append' | 'auto-scroll-to-bottom'): void {
    const supersedeKey =
      effect === 'auto-scroll-to-bottom' ? 'append-follow-bottom' : 'append'

    // auto-scroll-to-bottom 来自本地发送等明确追底意图，优先级高于普通 tail append。
    // 先丢弃尚未执行的普通 append，避免 storm 队列覆盖用户刚发送消息的追底事务。
    if (effect === 'auto-scroll-to-bottom') {
      this.transactions.dropBySupersedeKey('append')
    }

    this.transactions.enqueue(
      'append',
      () => this.transactionController.runAppendTransaction(effect),
      supersedeKey,
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

  private enqueueViewportCompactionTransaction(
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): void {
    this.transactions.enqueue(
      'viewportCompaction',
      () => this.transactionController.runViewportCompactionTransaction(target),
      'viewport-compaction',
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

  /**
   * commit timeout / cancel 后不能把 runtime 留在中间态。
   * 这里只恢复当前 generation 仍有效的事务，避免旧事务覆盖 feed 切换或 detach 后的新状态。
   */
  private recoverAfterCommitFailure(
    input: CommitRecoveryInput<TMessage, TOptimistic>,
  ): void {
    this.recovery.recoverAfterCommitFailure(input)
  }

  /**
   * timeout recovery 需要让 runtime.state 与回滚后的 snapshot 语义保持一致。
   * READY / READY_EMPTY 仍然表示可交互稳定态，其余 bootstrap 中间态统一回到 ATTACHED/INITIAL。
   */
  private deriveRuntimeStateFromSnapshot(
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ): RuntimeState {
    return this.recovery.deriveRuntimeStateFromSnapshot(snapshot)
  }

  private measureCurrentWindow(): HeightDelta[] {
    return this.recovery.measureCurrentWindow()
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

  private emitViewportAnchorChanged(
    reason: ViewportAnchorChangeReason,
    anchorOverride?: AnchorState | null,
  ): void {
    this.anchorEvents.emitChanged(reason, anchorOverride)
  }

  private readContainerSize(container: HTMLElement): ContainerSize {
    return {
      width: container.clientWidth,
      height: container.clientHeight,
    }
  }

  private attachDomListeners(container: HTMLElement): void {
    this.domInput.attachDomListeners(container)
  }

  private detachDomListeners(container: HTMLElement): void {
    this.domInput.detachDomListeners(container)
  }

  private cancelScheduledWork(): void {
    this.scrollFrame.cancelScheduledWork()
    this.resizeStabilization.cancelScheduledWork()
    this.anchorEvents.cancelScheduledWork()
  }

  private emitEvent(event: MessageViewportRuntimeEvent): void {
    this.eventHub.emitEvent(event)
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
    this.eventHub.emitError(code)
  }
}
