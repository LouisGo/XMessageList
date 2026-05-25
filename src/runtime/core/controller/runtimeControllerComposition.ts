import { TransactionRunner } from '../../transactions/transactionRunner'
import { DestinationIntentCoordinator } from '../commands/destinationIntentCoordinator'
import { ViewportCompactionCoordinator } from '../commands/viewportCompactionCoordinator'
import { RuntimeCommandRouter } from '../commands/runtimeCommandRouter'
import { RuntimeBottomLockCoordinator } from './runtimeBottomLockCoordinator'
import { RuntimeTransactionDiagnostics } from './runtimeTransactionDiagnostics'
import { AnchorCoordinator } from '../../dom/anchorCoordinator'
import { EdgeNeedCoordinator } from '../../events/edgeNeedCoordinator'
import { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import { ViewportTransactionController } from '../../transactions/viewportTransactionController'
import type { MessageViewportRuntimeOptions } from '../../types'
import type { RuntimeControllerHost } from './runtimeControllerHost'
import { createRuntimeControllerBaseServices } from './runtimeControllerBaseServices'
import { createRuntimeControllerEventServices } from './runtimeControllerEventServices'
import { createRuntimeControllerViewportServices } from './runtimeControllerViewportServices'
import { createRuntimeControllerServiceRefs } from './runtimeControllerServiceRefs'

export function createRuntimeControllerServices<TMessage, TOptimistic>(
  options: MessageViewportRuntimeOptions,
  host: RuntimeControllerHost<TMessage, TOptimistic>,
) {
  const serviceRefs = createRuntimeControllerServiceRefs<TMessage, TOptimistic>()
  // 构造期循环依赖只允许经由 service ref 延迟解引用；coordinator 构造器不得同步调用这些 peer 回调。
  const {
    config,
    scheduler,
    observerFactory,
    store,
    registry,
    lifecycle,
    spacer,
    renderWindow,
    measurement,
    scrollIntent,
    eventHub,
    projection,
    commit,
    scrollMotionOptions,
    edgeLoadThresholdPx,
    viewportCompactionSpacerThresholdPx,
    viewportCompactionDataWindowItemThreshold,
    diagnostics,
  } = createRuntimeControllerBaseServices<TMessage, TOptimistic>(
    options,
    host,
    () => serviceRefs.resizeStabilization.get().scheduleHeightStabilization(),
  )

  const anchor = new AnchorCoordinator<TMessage, TOptimistic>(
    registry,
    store,
    renderWindow,
    (currentFeedId, currentGeneration) =>
      serviceRefs.recovery.get().nextFrame(currentFeedId, currentGeneration),
    (nextScrollTop, source) =>
      serviceRefs.motion.get().writeScrollTop(nextScrollTop, source),
    host.emitError,
  )
  const bottomLock = new RuntimeBottomLockCoordinator<TMessage, TOptimistic>({
    registry,
    store,
    scrollIntent,
    projection,
    getDataSnapshot: host.getDataSnapshot,
    keepCurrentWindow: host.keepCurrentWindow,
    emitDiagnostic: host.emitDiagnostic,
  })
  const edge = new EdgeNeedCoordinator<TMessage, TOptimistic>(
    registry,
    store,
    projection,
    observerFactory,
    edgeLoadThresholdPx,
    host.getDataSnapshot,
    host.getLastScrollSource,
    host.canEmitEdgeNeeds,
    () => serviceRefs.destinationIntent.get().hasPendingFollowBottom(),
    () =>
      host.getState() === 'READY' &&
      serviceRefs.transactions.get().getPendingCount() === 0 &&
      store.getSnapshot().bootstrapState === 'READY',
    host.emitEvent,
  )
  const { anchorEvents, observationEvents } = createRuntimeControllerEventServices({
    scheduler,
    lifecycle,
    registry,
    store,
    host,
    getActiveTransactionKind: () =>
      serviceRefs.transactionDiagnostics.get().getActiveTransactionKind(),
    scheduleScrollbarDragEdgeRecheck: (reason) =>
      serviceRefs.scrollFrame.get().scheduleScrollbarDragEdgeRecheck(reason),
  })
  const destinationIntent = new DestinationIntentCoordinator<TMessage, TOptimistic>({
    lifecycle,
    renderWindow,
    scrollIntent,
    edge,
    getDataSnapshot: host.getDataSnapshot,
    getViewportSnapshot: () => store.getSnapshot(),
    getScrollTop: () => registry.getContainer()?.scrollTop ?? 0,
    setReadySubstate: (substate) => host.stateAxes.setReadySubstate(substate),
    getReadySubstate: () => host.stateAxes.getReadySubstate(),
    setDestinationState: (state) => {
      host.stateAxes.setDestinationState(state)
    },
    getDestinationState: () => host.stateAxes.getDestinationState(),
    enqueueFollowBottomTransaction: host.enqueueFollowBottomTransaction,
    enqueueJumpTransaction: host.enqueueJumpTransaction,
    enqueueRestoreTransaction: host.enqueueRestoreTransaction,
    emitEvent: host.emitEvent,
    emitDiagnostic: host.emitDiagnostic,
    spacerThresholdPx: viewportCompactionSpacerThresholdPx,
    dataWindowItemThreshold: viewportCompactionDataWindowItemThreshold,
  })
  serviceRefs.destinationIntent.setOnce(destinationIntent)
  const viewportCompaction = new ViewportCompactionCoordinator<TMessage, TOptimistic>({
    renderWindow,
    getViewportSnapshot: () => store.getSnapshot(),
    captureViewportAnchor: host.captureViewportAnchor,
    getState: host.getState,
    getReadySubstate: () => host.stateAxes.getReadySubstate(),
    setReadySubstate: (substate) => host.stateAxes.setReadySubstate(substate),
    enqueueViewportCompactionTransaction:
      host.enqueueViewportCompactionTransaction,
    emitEvent: host.emitEvent,
    emitDiagnostic: host.emitDiagnostic,
    spacerThresholdPx: viewportCompactionSpacerThresholdPx,
    dataWindowItemThreshold: viewportCompactionDataWindowItemThreshold,
  })
  const commandRouter = new RuntimeCommandRouter<TMessage, TOptimistic>({
    getState: host.getState,
    stateAxes: host.stateAxes,
    destinationIntent,
    viewportCompaction,
    setPendingBootstrap: host.setPendingBootstrap,
    tryRunPendingBootstrap: host.tryRunPendingBootstrap,
    enqueueResetTransaction: host.enqueueResetTransaction,
    setEdgeStatus: (viewportEdge, status) =>
      edge.setEdgeStatus(viewportEdge, status),
    emitDiagnostic: host.emitDiagnostic,
  })
  const motion = new DestinationMotionCoordinator<TMessage, TOptimistic>(
    registry,
    store,
    scheduler,
    scrollIntent,
    projection,
    scrollMotionOptions,
    (substate) => host.stateAxes.setReadySubstate(substate),
    (state) => host.stateAxes.setDestinationState(state),
    host.getCurrentFrame,
    () => host.getState() === 'DESTROYED',
    (reason) => host.emitViewportAnchorChanged(reason),
    (settle) =>
      serviceRefs.destinationIntent.get().handleDestinationMotionSettle(settle),
    (settle, context) =>
      serviceRefs.destinationIntent.get().handleDestinationMotionSupersede(settle, context),
    (scrollTop, source) =>
      serviceRefs.destinationIntent.get().recordActiveFollowBottomIntentScrollWrite(
        scrollTop,
        source,
      ),
    host.emitDiagnostic,
  )
  serviceRefs.motion.setOnce(motion)
  const transactionDiagnostics = new RuntimeTransactionDiagnostics({
    stateAxes: host.stateAxes,
    getPendingCount: () => serviceRefs.transactions.get().getPendingCount(),
    emitDiagnostic: host.emitDiagnostic,
  })
  serviceRefs.transactionDiagnostics.setOnce(transactionDiagnostics)
  const transactions = new TransactionRunner({
    onEnqueue: (kind, id) =>
      serviceRefs.transactionDiagnostics.get().handleEnqueue(kind, id),
    onStart: (kind, id) => {
      serviceRefs.transactionDiagnostics.get().handleStart(kind, id)
      serviceRefs.motion.get().cancel('transaction-supersede', {
        transactionKind: kind,
        transactionId: id,
      })
    },
    onComplete: (kind, id) =>
      serviceRefs.transactionDiagnostics.get().handleComplete(kind, id),
    onDrop: (kind, id, reason) =>
      serviceRefs.transactionDiagnostics.get().handleDrop(kind, id, reason),
    onError: (kind, id, error) =>
      serviceRefs.transactionDiagnostics.get().handleError(kind, id, error),
    onIdle: () => edge.flushDeferredEdgeState(),
  })
  serviceRefs.transactions.setOnce(transactions)
  const transactionController = new ViewportTransactionController<
    TMessage,
    TOptimistic
  >({
    registry,
    store,
    lifecycle,
    renderWindow,
    measurement,
    scrollIntent,
    projection,
    commit,
    anchor,
    motion,
    getDataSnapshot: host.getDataSnapshot,
    setState: host.setState,
    setViewportPhase: (phase) => host.stateAxes.setViewportPhase(phase),
    setTransactionState: (state) => host.stateAxes.setTransactionState(state),
    setDestinationState: (state) => host.stateAxes.setDestinationState(state),
    setPendingBootstrap: host.setPendingBootstrap,
    tryRunPendingBootstrap: host.tryRunPendingBootstrap,
    startPendingFollowBottom: (data, scrollTop) =>
      serviceRefs.destinationIntent.get().startPendingFollowBottom(data, scrollTop),
    ensureActiveFollowBottomIntent: (data, scrollTop) => {
      serviceRefs.destinationIntent.get().ensureActiveFollowBottomIntent(data, scrollTop)
    },
    hasActiveFollowBottomIntent: (data) =>
      serviceRefs.destinationIntent.get().hasActiveFollowBottomIntent(data),
    clearActiveFollowBottomIntent: (reason) =>
      serviceRefs.destinationIntent.get().clearActiveFollowBottomIntent(reason),
    reconcileBottomLockFromViewport: (data, reason) =>
      bottomLock.reconcileFromViewport(data, reason),
    keepCurrentWindow: host.keepCurrentWindow,
    measureCurrentWindow: host.measureCurrentWindow,
    waitForBootstrapSettle: (currentFeedId, currentGeneration) =>
      serviceRefs.recovery.get().waitForBootstrapSettle(currentFeedId, currentGeneration),
    recoverAfterCommitFailure: host.recoverAfterCommitFailure,
    deriveRuntimeStateFromSnapshot: host.deriveRuntimeStateFromSnapshot,
    emitViewportAnchorChanged: host.emitViewportAnchorChanged,
    emitDestinationSettled: (event) =>
      serviceRefs.destinationIntent.get().emitDestinationSettled(event),
    invalidateSpacerCache: () => spacer.invalidateEstimateCache(),
    emitEvent: host.emitEvent,
    emitDiagnostic: host.emitDiagnostic,
    emitError: host.emitError,
  })
  const viewportServices = createRuntimeControllerViewportServices<
    TMessage,
    TOptimistic
  >({
    host,
    config,
    scheduler,
    observerFactory,
    registry,
    lifecycle,
    store,
    measurement,
    spacer,
    motion,
    scrollIntent,
    renderWindow,
    transactions,
    transactionController,
    edge,
    anchor,
    destinationIntent,
    viewportCompaction,
    anchorEvents,
    observationEvents,
    bottomLock,
    commit,
    projection,
    edgeLoadThresholdPx,
    viewportCompactionDataWindowItemThreshold,
  })
  serviceRefs.scrollFrame.setOnce(viewportServices.scrollFrame)
  serviceRefs.resizeStabilization.setOnce(viewportServices.resizeStabilization)
  serviceRefs.recovery.setOnce(viewportServices.recovery)

  return {
    store,
    registry,
    lifecycle,
    renderWindow,
    measurement,
    resizeStabilization: viewportServices.resizeStabilization,
    scrollFrame: viewportServices.scrollFrame,
    domInput: viewportServices.domInput,
    destinationIntent,
    viewportCompaction,
    commandRouter,
    runtimeLifecycle: viewportServices.runtimeLifecycle,
    commit,
    anchor,
    edge,
    motion,
    transactions,
    transactionController,
    dataSnapshotCoordinator: viewportServices.dataSnapshotCoordinator,
    recovery: viewportServices.recovery,
    anchorEvents,
    observationEvents,
    eventHub,
    diagnostics,
  }
}
