import type { DestinationIntentCoordinator } from '../commands/destinationIntentCoordinator'
import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { RuntimeLifecycleCoordinator } from '../viewport/runtimeLifecycleCoordinator'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { TransactionRunner } from '../../transactions/transactionRunner'
import type {
  BottomLockState,
  MessageDataSnapshot,
  RuntimeState,
  ViewportEffect,
  ViewportModifier,
} from '../../types'
import type { RuntimeDiagnosticEmitter } from '../state/runtimeTypes'
import { getRuntimeItemKey } from '../../shared/utils'
import type { ViewportCompactionCoordinator } from '../commands/viewportCompactionCoordinator'
import { isDataWindowItemBudgetExceeded } from '../commands/viewportWindowBudget'

type RuntimeDataSnapshotDeps<TMessage, TOptimistic> = {
  renderWindow: RenderWindowEngine
  runtimeLifecycle: RuntimeLifecycleCoordinator<TMessage, TOptimistic>
  scrollIntent: ScrollIntentEngine
  transactions: TransactionRunner
  destinationIntent: DestinationIntentCoordinator<TMessage, TOptimistic>
  viewportCompaction: ViewportCompactionCoordinator<TMessage, TOptimistic>
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  setDataSnapshot: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => void
  getState: () => RuntimeState
  emitDiagnostic: RuntimeDiagnosticEmitter
  emitError: (code: string) => void
  dataWindowItemThreshold: number
  tryRunPendingBootstrap: () => boolean
  enqueuePrependTransaction: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => void
  enqueueAppendTransaction: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    effect: 'append' | 'auto-scroll-to-bottom',
  ) => void
  enqueueProjectionRefresh: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => void
  enqueueRemoveFromStartTransaction: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => void
  enqueueItemLocationTransaction: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => void
  enqueueIdentityRebindTransaction: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => void
  enqueueAnchorRiskTransaction: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => void
  enqueueResetTransaction: (
    reason: string,
    snapshot?: MessageDataSnapshot<TMessage, TOptimistic>,
  ) => void
  resolveEdgeStatusForSnapshot: (
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    viewportModifier: ViewportModifier | ViewportEffect,
  ) => void
}

export class RuntimeDataSnapshotCoordinator<TMessage, TOptimistic> {
  constructor(
    private readonly deps: RuntimeDataSnapshotDeps<TMessage, TOptimistic>,
  ) {}

  // data snapshot 是数据 revision 进入 viewport transaction 的唯一入口。
  // generation 切换先重置生命周期，同 generation 的 revision 变化只失效窗口索引。
  setDataSnapshot(snapshot: MessageDataSnapshot<TMessage, TOptimistic>): void {
    if (this.deps.getState() === 'DESTROYED') {
      return
    }

    const previous = this.deps.getDataSnapshot()
    const generationChanged =
      previous?.feedId !== snapshot.feedId ||
      previous?.generation !== snapshot.generation
    const dataIdentityChanged =
      generationChanged ||
      previous?.revision !== snapshot.revision
    const viewportModifier = getViewportModifier(snapshot.change)
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()

    this.acceptSnapshot(snapshot, previous, {
      generationChanged,
      dataIdentityChanged,
      viewportModifier,
    })

    if (this.drivePriorityRoutes(snapshot)) {
      return
    }

    if (
      this.deps.getState() === 'INITIAL' ||
      this.deps.getState() === 'ATTACHED'
    ) {
      return
    }

    this.driveReadyDataMutation(snapshot, {
      generationChanged,
      viewportModifier,
      previousBottomLockState,
    })
  }

  private acceptSnapshot(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    previous: MessageDataSnapshot<TMessage, TOptimistic> | null,
    input: {
      generationChanged: boolean
      dataIdentityChanged: boolean
      viewportModifier: ViewportModifier | ViewportEffect
    },
  ): void {
    if (input.generationChanged) {
      this.deps.runtimeLifecycle.resetForGeneration(
        snapshot.feedId,
        snapshot.generation,
      )
      this.emitGenerationResetDiagnostic(snapshot, previous)
    } else if (input.dataIdentityChanged) {
      this.deps.renderWindow.invalidateIndexCache()
    }

    this.deps.setDataSnapshot(snapshot)
    this.emitSnapshotDiagnostic(
      snapshot,
      input.generationChanged,
      input.viewportModifier,
    )
    this.emitDataWindowBudgetDiagnostic(snapshot)

    if (
      snapshot.hasMoreAfter &&
      this.deps.scrollIntent.getBottomLockState() === 'LOCKED'
    ) {
      this.deps.scrollIntent.setBottomLockState('UNLOCKED')
    }

    this.deps.resolveEdgeStatusForSnapshot(snapshot, input.viewportModifier)

    if (input.viewportModifier !== 'none') {
      this.deps.transactions.dropBySupersedeKey('window-slide')
    }

    if (isReservedViewportModifier(input.viewportModifier)) {
      this.deps.transactions.dropBySupersedeKey('data-refresh')
    }
  }

  private drivePriorityRoutes(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    if (this.deps.tryRunPendingBootstrap()) {
      return true
    }

    if (this.deps.destinationIntent.drivePendingFollowBottom(snapshot)) {
      return true
    }

    if (this.deps.destinationIntent.drivePendingDestinationRequest(snapshot)) {
      return true
    }

    if (this.deps.viewportCompaction.drivePendingViewportCompaction(snapshot)) {
      return true
    }

    return false
  }

  private driveReadyDataMutation(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    input: {
      generationChanged: boolean
      viewportModifier: ViewportModifier | ViewportEffect
      previousBottomLockState: BottomLockState
    },
  ): void {
    if (input.viewportModifier === 'auto-scroll-to-bottom') {
      this.deps.destinationIntent.ensureActiveFollowBottomIntentForCurrentScroll(
        snapshot,
      )
    }

    if (
      !isReservedViewportModifier(input.viewportModifier) &&
      this.deps.viewportCompaction.tryStartForDataMutation(
        snapshot,
        input.viewportModifier,
        {
          generationChanged: input.generationChanged,
          previousBottomLockState: input.previousBottomLockState,
        },
      )
    ) {
      return
    }

    this.enqueueModifierTransaction(snapshot, input.viewportModifier)
  }

  private enqueueModifierTransaction(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    viewportModifier: ViewportModifier | ViewportEffect,
  ): void {
    switch (viewportModifier) {
      case 'prepend':
        this.deps.enqueuePrependTransaction(snapshot)
        break
      case 'append':
      case 'auto-scroll-to-bottom':
        this.deps.enqueueAppendTransaction(snapshot, viewportModifier)
        break
      case 'remove-from-start':
        this.deps.enqueueRemoveFromStartTransaction(snapshot)
        break
      case 'item-location':
        this.deps.enqueueItemLocationTransaction(snapshot)
        break
      case 'identity-remap':
        this.deps.enqueueIdentityRebindTransaction(snapshot)
        break
      case 'anchor-risk':
        this.deps.enqueueAnchorRiskTransaction(snapshot)
        break
      case 'reset':
        this.deps.enqueueResetTransaction('data-reset', snapshot)
        break
      default:
        this.deps.enqueueProjectionRefresh(snapshot)
        break
    }
  }

  private emitSnapshotDiagnostic(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    generationChanged: boolean,
    viewportModifier: ViewportModifier | ViewportEffect,
  ): void {
    this.deps.emitDiagnostic({
      channel: 'data',
      severity: 'debug',
      name: 'data.setSnapshot',
      correlationId:
        `data:${snapshot.feedId}:${snapshot.generation}:${snapshot.revision}`,
      details: () => ({
        revision: snapshot.revision,
        itemCount: snapshot.items.length,
        viewportModifier,
        legacyViewportEffect: snapshot.change.viewportEffect ?? null,
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
  }

  private emitDataWindowBudgetDiagnostic(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    if (
      !isDataWindowItemBudgetExceeded(
        this.deps.dataWindowItemThreshold,
        snapshot.items.length,
      )
    ) {
      return
    }

    this.deps.emitDiagnostic({
      channel: 'data',
      severity: 'warn',
      name: 'data.windowBudgetExceeded',
      correlationId:
        `data:${snapshot.feedId}:${snapshot.generation}:${snapshot.revision}`,
      details: () => ({
        revision: snapshot.revision,
        itemCount: snapshot.items.length,
        dataWindowItemThreshold: this.deps.dataWindowItemThreshold,
      }),
    })
  }

  private emitGenerationResetDiagnostic(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    previous: MessageDataSnapshot<TMessage, TOptimistic> | null,
  ): void {
    this.deps.emitDiagnostic({
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
}

function getViewportModifier(
  change: MessageDataSnapshot['change'],
): ViewportModifier | ViewportEffect {
  return change.viewportModifier ?? change.viewportEffect ?? 'none'
}

function isReservedViewportModifier(
  modifier: ViewportModifier | ViewportEffect,
): modifier is Exclude<ViewportEffect, ViewportModifier> {
  return (
    modifier === 'remove-from-start' ||
    modifier === 'item-location' ||
    modifier === 'identity-remap' ||
    modifier === 'anchor-risk'
  )
}
