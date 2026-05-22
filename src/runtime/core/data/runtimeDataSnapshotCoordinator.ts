import type { DestinationIntentCoordinator } from '../commands/destinationIntentCoordinator'
import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { RuntimeLifecycleCoordinator } from '../viewport/runtimeLifecycleCoordinator'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { TransactionRunner } from '../../transactions/transactionRunner'
import type {
  MessageDataSnapshot,
  RuntimeState,
  ViewportEffect,
  ViewportModifier,
} from '../../types'
import type { RuntimeDiagnosticEmitter } from '../state/runtimeTypes'
import { getRuntimeItemKey } from '../../shared/utils'
import type { ViewportCompactionCoordinator } from '../commands/viewportCompactionCoordinator'

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
  tryRunPendingBootstrap: () => boolean
  enqueuePrependTransaction: () => void
  enqueueAppendTransaction: (
    effect: 'append' | 'auto-scroll-to-bottom',
  ) => void
  enqueueProjectionRefresh: () => void
  enqueueResetTransaction: (reason: string) => void
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

    if (generationChanged) {
      this.deps.runtimeLifecycle.resetForGeneration(
        snapshot.feedId,
        snapshot.generation,
      )
      this.emitGenerationResetDiagnostic(snapshot, previous)
    } else if (dataIdentityChanged) {
      this.deps.renderWindow.invalidateIndexCache()
    }

    this.deps.setDataSnapshot(snapshot)
    this.emitSnapshotDiagnostic(snapshot, generationChanged, viewportModifier)

    if (
      snapshot.hasMoreAfter &&
      this.deps.scrollIntent.getBottomLockState() === 'LOCKED'
    ) {
      this.deps.scrollIntent.setBottomLockState('UNLOCKED')
    }

    // reserved modifier 代表合同预留位，不能静默降级成普通 refresh；
    // 否则类型上承诺了 anchor/identity 语义，实际却可能破坏视觉锚点。
    if (isReservedViewportModifier(viewportModifier)) {
      this.deps.emitError(`viewport-modifier-${viewportModifier}-not-implemented`)
      return
    }

    if (viewportModifier !== 'none') {
      this.deps.transactions.dropBySupersedeKey('window-slide')
    }

    if (this.deps.tryRunPendingBootstrap()) {
      return
    }

    if (this.deps.destinationIntent.drivePendingFollowBottom(snapshot)) {
      return
    }

    if (this.deps.destinationIntent.drivePendingDestinationRequest(snapshot)) {
      return
    }

    if (this.deps.viewportCompaction.drivePendingViewportCompaction(snapshot)) {
      return
    }

    if (this.deps.getState() === 'INITIAL' || this.deps.getState() === 'ATTACHED') {
      return
    }

    if (
      this.deps.viewportCompaction.tryStartForDataMutation(snapshot, viewportModifier, {
        generationChanged,
        previousBottomLockState,
      })
    ) {
      return
    }

    switch (viewportModifier) {
      case 'prepend':
        this.deps.enqueuePrependTransaction()
        break
      case 'append':
      case 'auto-scroll-to-bottom':
        this.deps.enqueueAppendTransaction(viewportModifier)
        break
      case 'reset':
        this.deps.enqueueResetTransaction('data-reset')
        break
      default:
        this.deps.enqueueProjectionRefresh()
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
