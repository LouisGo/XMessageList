import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type {
  AnchorState,
  BottomLockState,
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageViewportRuntimeEvent,
  MessageViewportSnapshot,
  RuntimeState,
  ViewportModifier,
} from '../../types'
import type {
  PendingViewportCompaction,
  ReadySubstate,
  RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'
import { cloneAnchorState } from '../state/runtimeTypes'
import { isAroundRebuildSnapshot } from './pendingResponseGuards'
import { getViewportWindowBudgetState } from './viewportWindowBudget'

type ViewportCompactionDeps<TMessage, TOptimistic> = {
  renderWindow: RenderWindowEngine
  getViewportSnapshot: () => MessageViewportSnapshot<TMessage, TOptimistic>
  captureViewportAnchor: () => AnchorState | null
  getState: () => RuntimeState
  getReadySubstate: () => ReadySubstate
  setReadySubstate: (state: ReadySubstate) => void
  enqueueViewportCompactionTransaction: (
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ) => void
  emitEvent: (event: MessageViewportRuntimeEvent) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
  spacerThresholdPx: number
  dataWindowItemThreshold: number
}

export class ViewportCompactionCoordinator<TMessage, TOptimistic> {
  private pendingCompaction: PendingViewportCompaction | null = null

  private compactionCommandCounter = 0

  constructor(
    private readonly deps: ViewportCompactionDeps<TMessage, TOptimistic>,
  ) {}

  tryStartForDataMutation(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    viewportModifier: ViewportModifier,
    input: {
      generationChanged: boolean
      previousBottomLockState: BottomLockState
    },
  ): boolean {
    if (
      viewportModifier !== 'prepend' &&
      viewportModifier !== 'append'
    ) {
      return false
    }

    if (!this.canStartCompaction(snapshot, input)) {
      return false
    }

    const anchor = this.deps.captureViewportAnchor()

    if (!anchor || anchor.key.kind !== 'committed') {
      return false
    }

    this.compactionCommandCounter += 1
    const target: MessageIdentityAnchor = {
      messageId: anchor.key.messageId,
    }
    const commandId = `viewport-compaction-${this.compactionCommandCounter}`
    this.pendingCompaction = {
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      commandId,
      triggerRevision: snapshot.revision,
      triggerModifier: viewportModifier,
      target,
      commandTarget: cloneAnchorState(anchor),
      emittedAfterRevision: null,
    }
    this.deps.setReadySubstate('READY_VIEWPORT_COMPACTION_PENDING')
    this.emitPendingDiagnostic(snapshot)
    this.emitPendingNeed(snapshot)
    return true
  }

  drivePendingViewportCompaction(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    const pending = this.pendingCompaction

    if (!pending) {
      return false
    }

    if (
      pending.feedId !== snapshot.feedId ||
      pending.generation !== snapshot.generation
    ) {
      this.clearPendingViewportCompaction('generation-change')
      return false
    }

    if (!isAroundRebuildSnapshot(snapshot)) {
      // compaction 必须等待 around reset 短窗口；普通 append/prepend/patch
      // 不能因为仍包含视觉 anchor 就提前释放 pending。
      this.emitPendingNeed(snapshot)
      return true
    }

    const hasPendingTarget = this.hasCommittedMessage(snapshot, pending.target.messageId)
    const hasDeletedFallback = Boolean(
      snapshot.anchor && snapshot.anchorStatus === 'deleted',
    )

    if (!hasPendingTarget && !hasDeletedFallback) {
      this.emitPendingNeed(snapshot)
      return true
    }

    const currentAnchor = this.resolveCurrentViewportAnchor(snapshot)

    if (currentAnchor) {
      this.clearPendingViewportCompaction('data-ready-current-anchor')
      this.deps.enqueueViewportCompactionTransaction(currentAnchor)
      return true
    }

    if (this.hasCommittedMessage(snapshot, pending.target.messageId)) {
      this.clearPendingViewportCompaction('data-ready')
      this.deps.enqueueViewportCompactionTransaction(pending.commandTarget)
      return true
    }

    if (snapshot.anchor && snapshot.anchorStatus === 'deleted') {
      this.clearPendingViewportCompaction('fallback-anchor')
      this.deps.enqueueViewportCompactionTransaction(snapshot.anchor)
      return true
    }

    this.emitPendingNeed(snapshot)
    return true
  }

  clearPendingViewportCompaction(reason: string): void {
    const pending = this.pendingCompaction

    if (!pending) {
      return
    }

    this.pendingCompaction = null
    if (this.deps.getReadySubstate() === 'READY_VIEWPORT_COMPACTION_PENDING') {
      this.deps.setReadySubstate('READY_IDLE')
    }
    this.deps.emitDiagnostic({
      channel: 'data',
      severity: 'debug',
      name: 'viewportCompaction.pending.clear',
      correlationId: `command:${pending.commandId}`,
      details: () => ({
        reason,
        feedId: pending.feedId,
        generation: pending.generation,
        triggerRevision: pending.triggerRevision,
      }),
    })
  }

  private canStartCompaction(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    input: {
      generationChanged: boolean
      previousBottomLockState: BottomLockState
    },
  ): boolean {
    const viewportSnapshot = this.deps.getViewportSnapshot()
    const budget = getViewportWindowBudgetState({
      spacerThresholdPx: this.deps.spacerThresholdPx,
      dataWindowItemThreshold: this.deps.dataWindowItemThreshold,
      viewportSnapshot,
      dataSnapshot: snapshot,
    })

    return (
      !input.generationChanged &&
      this.pendingCompaction === null &&
      this.deps.getState() === 'READY' &&
      this.deps.getReadySubstate() === 'READY_IDLE' &&
      viewportSnapshot.bootstrapState === 'READY' &&
      input.previousBottomLockState !== 'LOCKED' &&
      (budget.spacerBudgetExceeded || budget.dataWindowItemBudgetExceeded)
    )
  }

  private emitPendingNeed(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    const pending = this.pendingCompaction

    if (!pending || pending.emittedAfterRevision === snapshot.revision) {
      return
    }

    pending.emittedAfterRevision = snapshot.revision
    this.deps.emitEvent({
      type: 'needMessagesAround',
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      reason: 'viewport-compaction',
      target: { ...pending.target },
    })
  }

  private emitPendingDiagnostic(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    const pending = this.pendingCompaction
    const viewportSnapshot = this.deps.getViewportSnapshot()

    if (!pending) {
      return
    }

    this.deps.emitDiagnostic({
      channel: 'data',
      severity: 'info',
      name: 'viewportCompaction.pending',
      correlationId: `command:${pending.commandId}`,
      details: () => ({
        revision: snapshot.revision,
        triggerModifier: pending.triggerModifier,
        target: pending.target,
        topSpacer: viewportSnapshot.topSpacer,
        bottomSpacer: viewportSnapshot.bottomSpacer,
        spacerThresholdPx: this.deps.spacerThresholdPx,
        dataWindowItemCount: snapshot.items.length,
        dataWindowItemThreshold: this.deps.dataWindowItemThreshold,
        ...getViewportWindowBudgetState({
          spacerThresholdPx: this.deps.spacerThresholdPx,
          dataWindowItemThreshold: this.deps.dataWindowItemThreshold,
          viewportSnapshot,
          dataSnapshot: snapshot,
        }),
      }),
    })
  }

  private hasCommittedMessage(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    messageId: string,
  ): boolean {
    return this.deps.renderWindow.findCommittedMessageIndex(
      snapshot.items,
      messageId,
    ) >= 0
  }

  private resolveCurrentViewportAnchor(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): AnchorState | null {
    const currentAnchor = this.deps.captureViewportAnchor()

    if (!currentAnchor || currentAnchor.key.kind !== 'committed') {
      return null
    }

    if (!this.hasCommittedMessage(snapshot, currentAnchor.key.messageId)) {
      return null
    }

    return cloneAnchorState(currentAnchor)
  }
}
