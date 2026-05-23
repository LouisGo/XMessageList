import { RuntimeDomInputCoordinator } from '../input/runtimeDomInputCoordinator'
import { RuntimeDataSnapshotCoordinator } from '../data/runtimeDataSnapshotCoordinator'
import { RuntimeLifecycleCoordinator } from '../viewport/runtimeLifecycleCoordinator'
import { RuntimeRecoveryAndMeasurement } from '../recovery/runtimeRecoveryAndMeasurement'
import { ResizeStabilizationCoordinator } from '../viewport/resizeStabilizationCoordinator'
import { ScrollFrameCoordinator } from '../viewport/scrollFrameCoordinator'
import type { AnchorCoordinator } from '../../dom/anchorCoordinator'
import type { MeasurementEngine } from '../../dom/measurementEngine'
import type { DomRegistry } from '../../dom/domRegistry'
import type { EdgeNeedCoordinator } from '../../events/edgeNeedCoordinator'
import type { ProjectionCoordinator } from '../projection/projectionCoordinator'
import type { CommitCoordinator } from '../projection/commitCoordinator'
import type { ProjectionStore } from '../state/projectionStore'
import type { LifecycleGuard } from '../state/lifecycleGuard'
import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import type { SpacerEngine } from '../../window/spacerEngine'
import type { TransactionRunner } from '../../transactions/transactionRunner'
import type { ViewportTransactionController } from '../../transactions/viewportTransactionController'
import type { DestinationIntentCoordinator } from '../commands/destinationIntentCoordinator'
import type { ViewportCompactionCoordinator } from '../commands/viewportCompactionCoordinator'
import type { RuntimeBottomLockCoordinator } from './runtimeBottomLockCoordinator'
import type { RuntimeViewportAnchorEvents } from './runtimeViewportAnchorEvents'
import type {
  NormalizedWindowConfig,
  RuntimeObserverFactory,
  RuntimeScheduler,
} from '../../types'
import type { RuntimeControllerHost } from './runtimeControllerHost'

type RuntimeControllerViewportServicesInput<TMessage, TOptimistic> = {
  host: RuntimeControllerHost<TMessage, TOptimistic>
  config: NormalizedWindowConfig
  scheduler: RuntimeScheduler
  observerFactory: RuntimeObserverFactory
  registry: DomRegistry
  lifecycle: LifecycleGuard
  store: ProjectionStore<TMessage, TOptimistic>
  measurement: MeasurementEngine
  spacer: SpacerEngine
  motion: DestinationMotionCoordinator<TMessage, TOptimistic>
  scrollIntent: ScrollIntentEngine
  renderWindow: RenderWindowEngine
  transactions: TransactionRunner
  transactionController: ViewportTransactionController<TMessage, TOptimistic>
  edge: EdgeNeedCoordinator<TMessage, TOptimistic>
  anchor: AnchorCoordinator<TMessage, TOptimistic>
  destinationIntent: DestinationIntentCoordinator<TMessage, TOptimistic>
  viewportCompaction: ViewportCompactionCoordinator<TMessage, TOptimistic>
  anchorEvents: RuntimeViewportAnchorEvents<TMessage, TOptimistic>
  bottomLock: RuntimeBottomLockCoordinator<TMessage, TOptimistic>
  commit: CommitCoordinator<TMessage, TOptimistic>
  projection: ProjectionCoordinator<TMessage, TOptimistic>
  edgeLoadThresholdPx: number
  viewportCompactionDataWindowItemThreshold: number
}

export function createRuntimeControllerViewportServices<
  TMessage,
  TOptimistic,
>(input: RuntimeControllerViewportServicesInput<TMessage, TOptimistic>) {
  const scrollFrame = new ScrollFrameCoordinator<TMessage, TOptimistic>({
    scheduler: input.scheduler,
    registry: input.registry,
    lifecycle: input.lifecycle,
    store: input.store,
    scrollIntent: input.scrollIntent,
    projection: input.projection,
    edge: input.edge,
    anchor: input.anchor,
    renderWindow: input.renderWindow,
    transactions: input.transactions,
    transactionController: input.transactionController,
    getDataSnapshot: input.host.getDataSnapshot,
    getCurrentFrame: input.host.getCurrentFrame,
    setCurrentFrame: input.host.setCurrentFrame,
    getState: input.host.getState,
    getReadySubstate: () => input.host.stateAxes.getReadySubstate(),
    getScrollbarDragIntentActive: input.host.getScrollbarDragIntentActive,
    getScrollbarDragEdgeIntent: input.host.getScrollbarDragEdgeIntent,
    setScrollbarDragEdgeIntent: input.host.setScrollbarDragEdgeIntent,
    getLastUserScrollTop: input.host.getLastUserScrollTop,
    setLastUserScrollTop: input.host.setLastUserScrollTop,
    getLastUserDistanceToBottom: input.host.getLastUserDistanceToBottom,
    setLastUserDistanceToBottom: input.host.setLastUserDistanceToBottom,
    getLastDiagnosticScrollSource: input.host.getLastDiagnosticScrollSource,
    setLastDiagnosticScrollSource: input.host.setLastDiagnosticScrollSource,
    setLastScrollSource: input.host.setLastScrollSource,
    getEdgeLoadThresholdPx: () => input.edgeLoadThresholdPx,
    updatePendingFollowBottomForUserScroll: (scrollTop) =>
      input.destinationIntent.updatePendingFollowBottomForUserScroll(scrollTop),
    updateActiveFollowBottomIntentForScroll: (data, scrollTop, source) =>
      input.destinationIntent.updateActiveFollowBottomIntentForScroll(
        data,
        scrollTop,
        source,
      ),
    scheduleViewportAnchorIdleEvent: () => input.anchorEvents.scheduleIdleEvent(),
    runAnchorlessWindowSlideTransaction: (nextWindow, expectedData) =>
      input.transactionController.runAnchorlessWindowSlideTransaction(
        nextWindow,
        expectedData,
      ),
    emitViewportAnchorChanged: input.host.emitViewportAnchorChanged,
    emitDiagnostic: input.host.emitDiagnostic,
    getEdgeThresholdPx: (metrics) => metrics.clientHeight * input.config.overscan,
  })
  const domInput = new RuntimeDomInputCoordinator<TMessage, TOptimistic>({
    registry: input.registry,
    scrollIntent: input.scrollIntent,
    motion: input.motion,
    scrollFrame,
    getState: input.host.getState,
    getCurrentFrame: input.host.getCurrentFrame,
    setScrollbarDragIntentActive: input.host.setScrollbarDragIntentActive,
    setScrollbarDragEdgeIntent: input.host.setScrollbarDragEdgeIntent,
    emitDiagnostic: input.host.emitDiagnostic,
  })
  const resizeStabilization = new ResizeStabilizationCoordinator<
    TMessage,
    TOptimistic
  >({
    scheduler: input.scheduler,
    observerFactory: input.observerFactory,
    registry: input.registry,
    lifecycle: input.lifecycle,
    store: input.store,
    measurement: input.measurement,
    spacer: input.spacer,
    motion: input.motion,
    scrollIntent: input.scrollIntent,
    renderWindow: input.renderWindow,
    transactions: input.transactions,
    transactionController: input.transactionController,
    getDataSnapshot: input.host.getDataSnapshot,
    getCurrentFrame: input.host.getCurrentFrame,
    setCurrentFrame: input.host.setCurrentFrame,
    getLastContainerSize: input.host.getLastContainerSize,
    setLastContainerSize: input.host.setLastContainerSize,
    captureViewportAnchor: input.host.captureViewportAnchor,
    emitViewportAnchorChanged: input.host.emitViewportAnchorChanged,
    emitDiagnostic: input.host.emitDiagnostic,
  })
  const runtimeLifecycle = new RuntimeLifecycleCoordinator<
    TMessage,
    TOptimistic
  >({
    registry: input.registry,
    store: input.store,
    lifecycle: input.lifecycle,
    transactions: input.transactions,
    commit: input.commit,
    resizeStabilization,
    edge: input.edge,
    measurement: input.measurement,
    motion: input.motion,
    scrollIntent: input.scrollIntent,
    renderWindow: input.renderWindow,
    spacer: input.spacer,
    destinationIntent: input.destinationIntent,
    viewportCompaction: input.viewportCompaction,
    stateAxes: input.host.stateAxes,
    heightCache: input.host.heightCache,
    eventListeners: input.host.eventListeners,
    getState: input.host.getState,
    setState: input.host.setState,
    getCurrentFrame: input.host.getCurrentFrame,
    getRetainedScrollTop: input.host.getRetainedScrollTop,
    setRetainedScrollTop: input.host.setRetainedScrollTop,
    setLastScrollSource: () => input.host.setLastScrollSource(null),
    setLastUserScrollTop: input.host.setLastUserScrollTop,
    setLastUserDistanceToBottom: input.host.setLastUserDistanceToBottom,
    setLastContainerSize: input.host.setLastContainerSize,
    attachDomListeners: input.host.attachDomListeners,
    detachDomListeners: input.host.detachDomListeners,
    cancelScheduledWork: input.host.cancelScheduledWork,
    readContainerSize: input.host.readContainerSize,
    reconcileReadyBottomLockFromViewport: (reason) =>
      input.bottomLock.reconcileReadyFromViewport(reason),
    tryRunPendingBootstrap: input.host.tryRunPendingBootstrap,
    emitViewportAnchorChanged: (reason) =>
      input.host.emitViewportAnchorChanged(reason),
    emitDiagnostic: input.host.emitDiagnostic,
  })
  const recovery = new RuntimeRecoveryAndMeasurement<TMessage, TOptimistic>({
    scheduler: input.scheduler,
    registry: input.registry,
    lifecycle: input.lifecycle,
    store: input.store,
    measurement: input.measurement,
    spacer: input.spacer,
    motion: input.motion,
    projection: input.projection,
    scrollIntent: input.scrollIntent,
    getState: input.host.getState,
    setState: input.host.setState,
    getCurrentFrame: input.host.getCurrentFrame,
    setCurrentFrame: input.host.setCurrentFrame,
    emitDiagnostic: input.host.emitDiagnostic,
  })
  const dataSnapshotCoordinator = new RuntimeDataSnapshotCoordinator<
    TMessage,
    TOptimistic
  >({
    renderWindow: input.renderWindow,
    runtimeLifecycle,
    scrollIntent: input.scrollIntent,
    transactions: input.transactions,
    destinationIntent: input.destinationIntent,
    viewportCompaction: input.viewportCompaction,
    getDataSnapshot: input.host.getDataSnapshot,
    setDataSnapshot: input.host.setDataSnapshot,
    getState: input.host.getState,
    emitDiagnostic: input.host.emitDiagnostic,
    emitError: input.host.emitError,
    dataWindowItemThreshold: input.viewportCompactionDataWindowItemThreshold,
    tryRunPendingBootstrap: input.host.tryRunPendingBootstrap,
    enqueuePrependTransaction: input.host.enqueuePrependTransaction,
    enqueueAppendTransaction: input.host.enqueueAppendTransaction,
    enqueueProjectionRefresh: input.host.enqueueProjectionRefresh,
    enqueueRemoveFromStartTransaction:
      input.host.enqueueRemoveFromStartTransaction,
    enqueueItemLocationTransaction: input.host.enqueueItemLocationTransaction,
    enqueueIdentityRebindTransaction:
      input.host.enqueueIdentityRebindTransaction,
    enqueueAnchorRiskTransaction: input.host.enqueueAnchorRiskTransaction,
    enqueueResetTransaction: input.host.enqueueResetTransaction,
    resolveEdgeStatusForSnapshot: (snapshot, viewportModifier) =>
      input.edge.resolveDataSnapshot(snapshot, viewportModifier),
  })

  return {
    scrollFrame,
    domInput,
    resizeStabilization,
    runtimeLifecycle,
    recovery,
    dataSnapshotCoordinator,
  }
}
