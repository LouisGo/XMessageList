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
import { runAppendTransaction } from './appendTransactions'
import { runBootstrapTransaction } from './bootstrapTransactions'
import { runContainerResizeTransaction } from './containerResizeTransactions'
import {
  runPrependTransaction,
  runWindowSlideTransaction,
} from './anchorTransactions'
import { runAnchorlessWindowSlideTransaction } from './anchorlessWindowSlideTransaction'
import {
  runJumpTransaction,
  runRestoreTransaction,
  runViewportCompactionTransaction,
} from './destinationTransactions'
import { runFollowBottomTransaction } from './followBottomTransactions'
import { runProjectionRefreshTransaction } from './projectionRefreshTransactions'
import {
  runAnchorRiskTransaction,
  runIdentityRebindTransaction,
  runItemLocationTransaction,
  runRemoveFromStartTransaction,
} from './reservedModifierTransactions'
import { shouldBootstrapCurrentDataForReset } from './dataMutationTransaction'

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
  ensureActiveFollowBottomIntent: (
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
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

  async runPrependTransaction(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): Promise<void> {
    return runPrependTransaction(this.deps, data)
  }

  async runAppendTransaction(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    effect: 'append' | 'auto-scroll-to-bottom',
  ): Promise<void> {
    return runAppendTransaction(this.deps, data, effect)
  }

  async runProjectionRefreshTransaction(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): Promise<void> {
    return runProjectionRefreshTransaction(this.deps, data)
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

  async runViewportCompactionTransaction(
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ): Promise<void> {
    return runViewportCompactionTransaction(this.deps, target)
  }

  async runRemoveFromStartTransaction(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): Promise<void> {
    return runRemoveFromStartTransaction(this.deps, data)
  }

  async runItemLocationTransaction(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): Promise<void> {
    return runItemLocationTransaction(this.deps, data)
  }

  async runIdentityRebindTransaction(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): Promise<void> {
    return runIdentityRebindTransaction(this.deps, data)
  }

  async runAnchorRiskTransaction(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): Promise<void> {
    return runAnchorRiskTransaction(this.deps, data)
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

  async runAnchorlessWindowSlideTransaction(
    nextWindow: RenderWindow,
    expectedData: { feedId: string; generation: number; revision: number },
  ): Promise<void> {
    return runAnchorlessWindowSlideTransaction(this.deps, nextWindow, expectedData)
  }

  async runContainerResizeTransaction(
    previousSize: ContainerSize,
    nextSize: ContainerSize,
  ): Promise<void> {
    return runContainerResizeTransaction(this.deps, previousSize, nextSize)
  }

  async runReset(
    reason: string,
    data?: MessageDataSnapshot<TMessage, TOptimistic>,
  ): Promise<void> {
    if (data && !shouldBootstrapCurrentDataForReset(this.deps, data)) {
      return
    }

    this.deps.setPendingBootstrap({ type: 'bootstrap', mode: 'latest' })
    this.deps.tryRunPendingBootstrap()
    if (!this.deps.getDataSnapshot()) {
      this.deps.emitError(`reset-${reason}`)
    }
  }
}
