import type { EdgeNeedCoordinator } from '../../events/edgeNeedCoordinator'
import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { DestinationMotionCancelContext } from '../../scroll/destinationMotionCoordinator'
import type { LifecycleGuard } from '../state/lifecycleGuard'
import {
  type DestinationMotionForcedStart,
  type DestinationMotionSettle,
  type PendingDestinationRequest,
  type ReadySubstate,
  type RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'
import {
  cloneDestinationCommandTarget,
  getIdentityTarget,
  getJumpForcedStart,
  hasCommittedMessage,
  resolvePendingJumpTarget,
  shouldRebuildDestinationWindow,
} from './destinationIntentHelpers'
import { isAroundRebuildSnapshot } from './pendingResponseGuards'
import {
  emitDestinationSettledEvent,
  emitPendingDestinationNeed,
} from './destinationIntentEvents'
import { ActiveFollowBottomIntentTracker } from './activeFollowBottomIntentTracker'
import { PendingFollowBottomTracker } from './pendingFollowBottomTracker'
import type {
  AnchorState,
  DestinationState,
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageViewportSnapshot,
  MessageViewportRuntimeEvent,
  ScrollSource,
} from '../../types'

type DestinationIntentDeps<TMessage, TOptimistic> = {
  lifecycle: LifecycleGuard
  renderWindow: RenderWindowEngine
  scrollIntent: ScrollIntentEngine
  edge: EdgeNeedCoordinator<TMessage, TOptimistic>
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  getViewportSnapshot: () => MessageViewportSnapshot<TMessage, TOptimistic>
  getScrollTop: () => number
  setReadySubstate: (state: ReadySubstate) => void
  getReadySubstate: () => ReadySubstate
  setDestinationState: (state: DestinationState) => void
  getDestinationState: () => DestinationState
  enqueueFollowBottomTransaction: () => void
  enqueueJumpTransaction: (
    target: MessageIdentityAnchor,
    options?: {
      forceAnimateFrom?: DestinationMotionForcedStart
      allowPreposition?: boolean
      animate?: boolean
      originalTarget?: MessageIdentityAnchor
    },
  ) => void
  enqueueRestoreTransaction: (
    target: AnchorState | MessageDataSnapshot<TMessage, TOptimistic>['anchor'],
  ) => void
  emitEvent: (event: MessageViewportRuntimeEvent) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
  spacerThresholdPx: number
}
export class DestinationIntentCoordinator<TMessage, TOptimistic> {
  private pendingDestinationRequest: PendingDestinationRequest | null = null
  private readonly pendingFollowBottom: PendingFollowBottomTracker<
    TMessage,
    TOptimistic
  >
  private readonly activeFollowBottom: ActiveFollowBottomIntentTracker<
    TMessage,
    TOptimistic
  >
  private destinationCommandCounter = 0

  constructor(private readonly deps: DestinationIntentDeps<TMessage, TOptimistic>) {
    this.pendingFollowBottom = new PendingFollowBottomTracker({
      edge: deps.edge,
      lifecycle: deps.lifecycle,
      scrollIntent: deps.scrollIntent,
      getDataSnapshot: deps.getDataSnapshot,
      setReadySubstate: deps.setReadySubstate,
      getReadySubstate: deps.getReadySubstate,
      setDestinationState: deps.setDestinationState,
      getDestinationState: deps.getDestinationState,
      emitEvent: deps.emitEvent,
      emitDiagnostic: deps.emitDiagnostic,
    })
    this.activeFollowBottom = new ActiveFollowBottomIntentTracker({
      getDataSnapshot: deps.getDataSnapshot,
      emitDiagnostic: deps.emitDiagnostic,
    })
  }
  hasPendingFollowBottom(): boolean {
    return this.pendingFollowBottom.has()
  }
  startFollowBottomCommand(): void {
    const data = this.deps.getDataSnapshot()

    if (!data) {
      return
    }

    const scrollTop = this.deps.getScrollTop()
    const commandId = this.activeFollowBottom.ensure(data, scrollTop).commandId

    if (data.hasMoreAfter || this.shouldRebuildDestinationWindow()) {
      // followBottom 面向 feed latest；当前 DataWindow 还缺 latest page 时请求 latest window。
      this.startPendingFollowBottom(data, scrollTop, commandId)
      return
    }

    this.deps.enqueueFollowBottomTransaction()
  }

  startJumpCommand(
    target: MessageIdentityAnchor,
    origin?: MessageIdentityAnchor,
  ): void {
    const data = this.deps.getDataSnapshot()

    if (!data) {
      return
    }

    const forceAnimateFrom = getJumpForcedStart(origin, target)
    const animateOnResolve = forceAnimateFrom !== undefined

    if (this.shouldRebuildDestinationWindow()) {
      this.startPendingDestinationRequest('jump', target, target, {
        forceAnimateFrom,
        animateOnResolve,
      })
      return
    }

    if (!hasCommittedMessage(this.deps.renderWindow, data, target.messageId)) {
      this.startPendingDestinationRequest('jump', target, target, {
        forceAnimateFrom,
        animateOnResolve,
      })
      return
    }

    this.clearPendingDestinationRequest()
    this.deps.enqueueJumpTransaction(target, {
      animate: animateOnResolve,
      allowPreposition: false,
    })
  }

  startRestoreCommand(target: AnchorState | MessageIdentityAnchor): void {
    const data = this.deps.getDataSnapshot()

    if (!data) {
      return
    }

    const identityTarget = getIdentityTarget(target)

    if (identityTarget && this.shouldRebuildDestinationWindow()) {
      this.startPendingDestinationRequest('restore', identityTarget, target)
      return
    }

    if (
      identityTarget &&
      !hasCommittedMessage(this.deps.renderWindow, data, identityTarget.messageId)
    ) {
      this.startPendingDestinationRequest('restore', identityTarget, target)
      return
    }

    this.clearPendingDestinationRequest()
    this.deps.enqueueRestoreTransaction(target)
  }

  drivePendingFollowBottom(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    const result = this.pendingFollowBottom.drive(snapshot)

    if (result === 'none') {
      return false
    }

    if (result === 'generation-change') {
      this.activeFollowBottom.clear('generation-change')
      return false
    }

    if (result === 'pending') {
      return true
    }

    this.deps.enqueueFollowBottomTransaction()
    return true
  }

  drivePendingDestinationRequest(
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

    if (!isAroundRebuildSnapshot(snapshot)) {
      // pending destination 只消费 around-target reset；普通同 generation
      // snapshot 即使包含 target，也不能提前完成远距离 rebuild。
      this.emitPendingDestinationNeed(snapshot)
      return true
    }

    if (pending.intent === 'jump') {
      const resolvedJumpTarget = resolvePendingJumpTarget(
        this.deps.renderWindow,
        snapshot,
        pending.target,
      )

      if (!resolvedJumpTarget) {
        this.emitPendingDestinationNeed(snapshot)
        return true
      }

      this.clearPendingDestinationRequest()
      this.deps.enqueueJumpTransaction(resolvedJumpTarget, {
        forceAnimateFrom: pending.forceAnimateFrom,
        animate: pending.animateOnResolve,
        originalTarget: pending.target,
      })
      return true
    }

    if (
      snapshot.anchorStatus === 'deleted' &&
      snapshot.anchor
    ) {
      this.clearPendingDestinationRequest()
      this.deps.enqueueRestoreTransaction(snapshot.anchor)
      return true
    }

    if (
      !hasCommittedMessage(this.deps.renderWindow, snapshot, pending.target.messageId)
    ) {
      this.emitPendingDestinationNeed(snapshot)
      return true
    }

    this.clearPendingDestinationRequest()
    this.deps.enqueueRestoreTransaction(pending.commandTarget)
    return true
  }

  clearPendingFollowBottom(): void {
    this.pendingFollowBottom.clear()
  }

  clearPendingDestinationRequest(): void {
    if (!this.pendingDestinationRequest) {
      return
    }

    this.pendingDestinationRequest = null

    if (this.deps.getReadySubstate() === 'READY_DESTINATION_PENDING') {
      this.deps.setReadySubstate('READY_IDLE')
    }
    if (this.deps.getDestinationState() !== 'motionActive') {
      this.deps.setDestinationState('idle')
    }
  }

  hasActiveFollowBottomIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    return this.activeFollowBottom.has(data)
  }

  clearActiveFollowBottomIntent(reason: string): void {
    this.activeFollowBottom.clear(reason)
  }

  updateActiveFollowBottomIntentForScroll(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    scrollSource: ScrollSource,
  ): void {
    const cancelReason = this.activeFollowBottom.updateForScroll(
      data,
      scrollTop,
      scrollSource,
    )

    if (cancelReason === 'user-scroll-up') {
      this.clearPendingFollowBottom()
    }
  }

  recordActiveFollowBottomIntentScrollWrite(
    scrollTop: number,
    source: ScrollSource,
  ): void {
    this.activeFollowBottom.recordScrollWrite(scrollTop, source)
  }

  handleDestinationMotionSettle(
    settle: DestinationMotionSettle<TMessage, TOptimistic>,
  ): void {
    if (settle.destination) {
      this.emitDestinationSettled(settle.destination)
    }

    if (
      settle.source !== 'followBottom' ||
      settle.bottomLockState !== 'LOCKED' ||
      !this.hasActiveFollowBottomIntent(settle.data)
    ) {
      return
    }

    this.clearActiveFollowBottomIntent('settled-locked')
  }

  handleDestinationMotionSupersede(
    settle: DestinationMotionSettle<TMessage, TOptimistic>,
    context: DestinationMotionCancelContext | null,
  ): void {
    const destination = settle.destination

    if (!destination || destination.intent !== 'jump') {
      return
    }

    const data = this.deps.getDataSnapshot()

    if (!data) {
      return
    }

    const originalTarget = destination.target
    const resolvedTarget =
      destination.resolvedTarget && hasCommittedMessage(
        this.deps.renderWindow,
        data,
        destination.resolvedTarget.messageId,
      )
        ? destination.resolvedTarget
        : resolvePendingJumpTarget(this.deps.renderWindow, data, originalTarget)

    this.deps.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'destinationMotion.reschedule',
      correlationId:
        `motion:${settle.source}:${settle.data.feedId}:${settle.data.generation}:${settle.data.revision}`,
      details: () => ({
        source: settle.source,
        intent: destination.intent,
        reason: 'transaction-supersede',
        transactionKind: context?.transactionKind ?? null,
        transactionId: context?.transactionId ?? null,
        target: originalTarget,
        resolvedTarget: resolvedTarget ?? null,
      }),
    })

    if (!resolvedTarget) {
      this.startPendingDestinationRequest('jump', originalTarget, originalTarget, {
        animateOnResolve: true,
        preserveBottomLockState: true,
      })
      return
    }

    this.clearPendingDestinationRequest()
    this.deps.enqueueJumpTransaction(resolvedTarget, {
      animate: true,
      allowPreposition: false,
      originalTarget,
    })
  }

  updatePendingFollowBottomForUserScroll(scrollTop: number): void {
    const cancelReason = this.pendingFollowBottom.updateForUserScroll(scrollTop)

    if (cancelReason === 'user-scroll-up') {
      this.clearActiveFollowBottomIntent('user-scroll-up')
    }
  }

  startPendingFollowBottom(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    commandId?: string,
  ): void {
    const resolvedCommandId =
      commandId ?? this.ensureActiveFollowBottomIntent(data, scrollTop).commandId
    this.pendingFollowBottom.start(data, scrollTop, resolvedCommandId)
  }

  private startPendingDestinationRequest(
    intent: 'jump' | 'restore',
    target: MessageIdentityAnchor,
    commandTarget: AnchorState | MessageIdentityAnchor,
    options: {
      forceAnimateFrom?: DestinationMotionForcedStart
      animateOnResolve?: boolean
      preserveBottomLockState?: boolean
    } = {},
  ): void {
    const data = this.deps.getDataSnapshot()

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
      commandTarget: cloneDestinationCommandTarget(commandTarget),
      emittedAfterRevision: null,
      forceAnimateFrom: options.forceAnimateFrom,
      animateOnResolve: options.animateOnResolve ?? true,
    }
    this.deps.setReadySubstate('READY_DESTINATION_PENDING')
    this.deps.setDestinationState('pendingData')
    if (!options.preserveBottomLockState) {
      this.deps.scrollIntent.setBottomLockState('UNLOCKED')
    }
    this.emitPendingDestinationNeed(data)
  }

  ensureActiveFollowBottomIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
  ) {
    return this.activeFollowBottom.ensure(data, scrollTop)
  }

  ensureActiveFollowBottomIntentForCurrentScroll(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ) {
    return this.activeFollowBottom.ensure(data, this.deps.getScrollTop())
  }

  private emitPendingDestinationNeed(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    emitPendingDestinationNeed(this.deps, this.pendingDestinationRequest, data)
  }

  emitDestinationSettled(event: {
    intent: 'jump'
    target: MessageIdentityAnchor
    resolution: 'target' | 'fallback-deleted'
    resolvedTarget?: MessageIdentityAnchor
  }): void {
    emitDestinationSettledEvent(this.deps, event)
  }
  private shouldRebuildDestinationWindow(): boolean {
    return shouldRebuildDestinationWindow(
      this.deps.spacerThresholdPx,
      this.deps.getViewportSnapshot(),
    )
  }
}
