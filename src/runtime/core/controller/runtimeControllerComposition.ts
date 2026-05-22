import { TransactionRunner } from '../../transactions/transactionRunner'
import type { ResizeStabilizationCoordinator } from '../viewport/resizeStabilizationCoordinator'
import { DestinationIntentCoordinator } from '../commands/destinationIntentCoordinator'
import { ViewportCompactionCoordinator } from '../commands/viewportCompactionCoordinator'
import { RuntimeCommandRouter } from '../commands/runtimeCommandRouter'
import type { RuntimeRecoveryAndMeasurement } from '../recovery/runtimeRecoveryAndMeasurement'
import type { ScrollFrameCoordinator } from '../viewport/scrollFrameCoordinator'
import { RuntimeBottomLockCoordinator } from './runtimeBottomLockCoordinator'
import { RuntimeTransactionDiagnostics } from './runtimeTransactionDiagnostics'
import { RuntimeViewportAnchorEvents } from './runtimeViewportAnchorEvents'
import { AnchorCoordinator } from '../../dom/anchorCoordinator'
import { EdgeNeedCoordinator } from '../../events/edgeNeedCoordinator'
import { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import { ViewportTransactionController } from '../../transactions/viewportTransactionController'
import type { MessageViewportRuntimeOptions } from '../../types'
import type { RuntimeControllerHost } from './runtimeControllerHost'
import { createRuntimeControllerBaseServices } from './runtimeControllerBaseServices'
import { createRuntimeControllerViewportServices } from './runtimeControllerViewportServices'

export function createRuntimeControllerServices<TMessage, TOptimistic>(
  options: MessageViewportRuntimeOptions,
  host: RuntimeControllerHost<TMessage, TOptimistic>,
) {
  let resizeStabilization: ResizeStabilizationCoordinator<
    TMessage,
    TOptimistic
  > | null = null
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
    diagnostics,
  } = createRuntimeControllerBaseServices<TMessage, TOptimistic>(
    options,
    host,
    () => resizeStabilization?.scheduleHeightStabilization(),
  )
  let recovery: RuntimeRecoveryAndMeasurement<TMessage, TOptimistic> | null = null
  let motion: DestinationMotionCoordinator<TMessage, TOptimistic> | null = null
  let edge: EdgeNeedCoordinator<TMessage, TOptimistic> | null = null
  let destinationIntent: DestinationIntentCoordinator<
    TMessage,
    TOptimistic
  > | null = null
  let transactions: TransactionRunner | null = null
  let transactionController: ViewportTransactionController<
    TMessage,
    TOptimistic
  > | null = null
  let scrollFrame: ScrollFrameCoordinator<TMessage, TOptimistic> | null = null

  const anchor = new AnchorCoordinator<TMessage, TOptimistic>(
    registry,
    store,
    renderWindow,
    (currentFeedId, currentGeneration) =>
      recovery!.nextFrame(currentFeedId, currentGeneration),
    (nextScrollTop, source) => motion!.writeScrollTop(nextScrollTop, source),
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
  edge = new EdgeNeedCoordinator<TMessage, TOptimistic>(
    registry,
    store,
    observerFactory,
    edgeLoadThresholdPx,
    host.getDataSnapshot,
    host.getLastScrollSource,
    host.canEmitEdgeNeeds,
    () => destinationIntent!.hasPendingFollowBottom(),
    host.emitEvent,
  )
  let transactionDiagnostics: RuntimeTransactionDiagnostics | null = null
  const anchorEvents = new RuntimeViewportAnchorEvents({
    scheduler,
    lifecycle,
    getDataSnapshot: host.getDataSnapshot,
    getState: host.getState,
    getActiveTransactionKind: () =>
      transactionDiagnostics!.getActiveTransactionKind(),
    captureViewportAnchor: host.captureViewportAnchor,
    scheduleScrollbarDragEdgeRecheck: (reason) =>
      scrollFrame!.scheduleScrollbarDragEdgeRecheck(reason),
    emitEvent: host.emitEvent,
  })
  destinationIntent = new DestinationIntentCoordinator<TMessage, TOptimistic>({
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
  })
  const viewportCompaction = new ViewportCompactionCoordinator<
    TMessage,
    TOptimistic
  >({
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
  })
  const commandRouter = new RuntimeCommandRouter<TMessage, TOptimistic>({
    getState: host.getState,
    stateAxes: host.stateAxes,
    destinationIntent,
    viewportCompaction,
    setPendingBootstrap: host.setPendingBootstrap,
    tryRunPendingBootstrap: host.tryRunPendingBootstrap,
    enqueueResetTransaction: host.enqueueResetTransaction,
    emitDiagnostic: host.emitDiagnostic,
  })
  motion = new DestinationMotionCoordinator<TMessage, TOptimistic>(
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
    (settle) => destinationIntent!.handleDestinationMotionSettle(settle),
    (settle, context) =>
      destinationIntent!.handleDestinationMotionSupersede(settle, context),
    (scrollTop, source) =>
      destinationIntent!.recordActiveFollowBottomIntentScrollWrite(
        scrollTop,
        source,
      ),
    host.emitDiagnostic,
  )
  transactionDiagnostics = new RuntimeTransactionDiagnostics({
    stateAxes: host.stateAxes,
    getPendingCount: () => transactions!.getPendingCount(),
    emitDiagnostic: host.emitDiagnostic,
  })
  transactions = new TransactionRunner({
    onEnqueue: (kind, id) => transactionDiagnostics!.handleEnqueue(kind, id),
    onStart: (kind, id) => {
      transactionDiagnostics!.handleStart(kind, id)
      motion!.cancel('transaction-supersede', {
        transactionKind: kind,
        transactionId: id,
      })
    },
    onComplete: (kind, id) => transactionDiagnostics!.handleComplete(kind, id),
    onDrop: (kind, id, reason) =>
      transactionDiagnostics!.handleDrop(kind, id, reason),
    onError: (kind, id, error) =>
      transactionDiagnostics!.handleError(kind, id, error),
  })
  transactionController = new ViewportTransactionController<
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
      destinationIntent!.startPendingFollowBottom(data, scrollTop),
    ensureActiveFollowBottomIntent: (data, scrollTop) => {
      destinationIntent!.ensureActiveFollowBottomIntent(data, scrollTop)
    },
    hasActiveFollowBottomIntent: (data) =>
      destinationIntent!.hasActiveFollowBottomIntent(data),
    clearActiveFollowBottomIntent: (reason) =>
      destinationIntent!.clearActiveFollowBottomIntent(reason),
    reconcileBottomLockFromViewport: (data, reason) =>
      bottomLock.reconcileFromViewport(data, reason),
    keepCurrentWindow: host.keepCurrentWindow,
    measureCurrentWindow: host.measureCurrentWindow,
    waitForBootstrapSettle: (currentFeedId, currentGeneration) =>
      recovery!.waitForBootstrapSettle(currentFeedId, currentGeneration),
    recoverAfterCommitFailure: host.recoverAfterCommitFailure,
    deriveRuntimeStateFromSnapshot: host.deriveRuntimeStateFromSnapshot,
    emitViewportAnchorChanged: host.emitViewportAnchorChanged,
    emitDestinationSettled: (event) =>
      destinationIntent!.emitDestinationSettled(event),
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
    bottomLock,
    commit,
    projection,
    edgeLoadThresholdPx,
  })
  scrollFrame = viewportServices.scrollFrame
  resizeStabilization = viewportServices.resizeStabilization
  recovery = viewportServices.recovery

  return {
    store,
    registry,
    lifecycle,
    renderWindow,
    measurement,
    resizeStabilization,
    scrollFrame,
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
    recovery,
    anchorEvents,
    eventHub,
    diagnostics,
  }
}
