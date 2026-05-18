import type { EdgeNeedCoordinator } from '../../events/edgeNeedCoordinator'
import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { DestinationMotionCancelContext } from '../../scroll/destinationMotionCoordinator'
import type { LifecycleGuard } from '../state/lifecycleGuard'
import {
  USER_SCROLL_DIRECTION_EPSILON_PX,
  type ActiveFollowBottomIntent,
  type DestinationMotionForcedStart,
  type DestinationMotionSettle,
  type PendingDestinationRequest,
  type PendingFollowBottom,
  type ReadySubstate,
  type RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'
import {
  cloneDestinationCommandTarget,
  getIdentityTarget,
  getJumpForcedStart,
  hasCommittedMessage,
  resolvePendingJumpTarget,
} from './destinationIntentHelpers'
import type {
  AnchorState,
  DestinationState,
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageViewportSnapshot,
  MessageViewportRuntimeEvent,
  ScrollSource,
} from '../../types'

const DESTINATION_REBUILD_SPACER_THRESHOLD_PX = 10_000

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
}
export class DestinationIntentCoordinator<TMessage, TOptimistic> {
  private pendingFollowBottom: PendingFollowBottom | null = null
  private activeFollowBottomIntent: ActiveFollowBottomIntent | null = null
  private pendingDestinationRequest: PendingDestinationRequest | null = null
  private followBottomCommandCounter = 0
  private destinationCommandCounter = 0
  constructor(private readonly deps: DestinationIntentDeps<TMessage, TOptimistic>) {}
  hasPendingFollowBottom(): boolean {
    return this.pendingFollowBottom !== null
  }
  startFollowBottomCommand(): void {
    const data = this.deps.getDataSnapshot()

    if (!data) {
      return
    }

    const scrollTop = this.deps.getScrollTop()
    const commandId = this.startActiveFollowBottomIntent(data, scrollTop).commandId

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

    if (!this.hasCommittedMessage(data, target.messageId)) {
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

    if (identityTarget && !this.hasCommittedMessage(data, identityTarget.messageId)) {
      this.startPendingDestinationRequest('restore', identityTarget, target)
      return
    }

    this.clearPendingDestinationRequest()
    this.deps.enqueueRestoreTransaction(target)
  }

  drivePendingFollowBottom(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
  ): boolean {
    const pending = this.pendingFollowBottom

    if (!pending) {
      return false
    }

    if (
      pending.feedId !== snapshot.feedId ||
      pending.generation !== snapshot.generation
    ) {
      this.clearPendingFollowBottom()
      this.clearActiveFollowBottomIntent('generation-change')
      return false
    }

    if (snapshot.hasMoreAfter) {
      // 每个 data revision 最多发一次 latest-window need，避免 BFF 未返回时重复拉取。
      this.emitPendingFollowBottomNeed(snapshot)
      return true
    }

    this.clearPendingFollowBottom()
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

    const resolvedJumpTarget =
      pending.intent === 'jump'
        ? this.resolvePendingJumpTarget(snapshot, pending.target)
        : null

    if (
      pending.intent === 'jump'
        ? !resolvedJumpTarget
        : !this.hasCommittedMessage(snapshot, pending.target.messageId)
    ) {
      this.emitPendingDestinationNeed(snapshot)
      return true
    }

    this.clearPendingDestinationRequest()

    if (pending.intent === 'jump') {
      this.deps.enqueueJumpTransaction(resolvedJumpTarget, {
        forceAnimateFrom: pending.forceAnimateFrom,
        animate: pending.animateOnResolve,
        originalTarget: pending.target,
      })
      return true
    }

    this.deps.enqueueRestoreTransaction(pending.commandTarget)
    return true
  }

  clearPendingFollowBottom(): void {
    if (!this.pendingFollowBottom) {
      return
    }

    this.pendingFollowBottom = null

    if (this.deps.getReadySubstate() === 'READY_FOLLOW_BOTTOM_PENDING') {
      this.deps.setReadySubstate('READY_IDLE')
    }
    if (this.deps.getDestinationState() === 'pendingData') {
      this.deps.setDestinationState('idle')
    }
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
    return (
      this.activeFollowBottomIntent?.feedId === data.feedId &&
      this.activeFollowBottomIntent.generation === data.generation
    )
  }

  clearActiveFollowBottomIntent(reason: string): void {
    const intent = this.activeFollowBottomIntent

    if (!intent) {
      return
    }

    this.activeFollowBottomIntent = null
    this.deps.emitDiagnostic({
      channel: 'motion',
      severity: 'debug',
      name: 'followBottom.intent.clear',
      correlationId: `command:${intent.commandId}`,
      details: () => ({
        reason,
        feedId: intent.feedId,
        generation: intent.generation,
        lastScrollTop: intent.lastScrollTop,
      }),
    })
  }

  updateActiveFollowBottomIntentForScroll(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    scrollSource: ScrollSource,
  ): void {
    const intent = this.activeFollowBottomIntent

    if (!intent) {
      return
    }

    if (intent.feedId !== data.feedId || intent.generation !== data.generation) {
      this.clearActiveFollowBottomIntent('generation-change')
      return
    }

    if (
      scrollSource === 'user' &&
      scrollTop < intent.lastScrollTop - USER_SCROLL_DIRECTION_EPSILON_PX
    ) {
      this.clearActiveFollowBottomIntent('user-scroll-up')
      this.clearPendingFollowBottom()
      return
    }

    intent.lastScrollTop = scrollTop
  }

  recordActiveFollowBottomIntentScrollWrite(
    scrollTop: number,
    source: ScrollSource,
  ): void {
    const intent = this.activeFollowBottomIntent
    const data = this.deps.getDataSnapshot()

    if (
      !intent ||
      !data ||
      source !== 'followBottom' ||
      intent.feedId !== data.feedId ||
      intent.generation !== data.generation
    ) {
      return
    }

    intent.lastScrollTop = scrollTop
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
      destination.resolvedTarget && this.hasCommittedMessage(
        data,
        destination.resolvedTarget.messageId,
      )
        ? destination.resolvedTarget
        : this.resolvePendingJumpTarget(data, originalTarget)

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
    const pending = this.pendingFollowBottom

    if (!pending) {
      return
    }

    if (scrollTop < pending.lastScrollTop - USER_SCROLL_DIRECTION_EPSILON_PX) {
      // 用户主动向上阅读时，pending follow-bottom 必须让位，不能继续追逐 latest。
      this.clearPendingFollowBottom()
      this.clearActiveFollowBottomIntent('user-scroll-up')
      return
    }

    pending.lastScrollTop = scrollTop
  }

  startPendingFollowBottom(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    commandId?: string,
  ): void {
    const resolvedCommandId =
      commandId ?? this.ensureActiveFollowBottomIntent(data, scrollTop).commandId
    this.pendingFollowBottom = {
      feedId: data.feedId,
      generation: data.generation,
      commandId: resolvedCommandId,
      emittedAfterRevision: null,
      lastScrollTop: scrollTop,
    }
    this.deps.setReadySubstate('READY_FOLLOW_BOTTOM_PENDING')
    this.deps.setDestinationState('pendingData')
    this.deps.scrollIntent.setBottomLockState('UNLOCKED')
    this.deps.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'followBottom.pending',
      correlationId: `command:${resolvedCommandId}`,
      details: () => ({
        revision: data.revision,
        itemCount: data.items.length,
        hasMoreBefore: data.hasMoreBefore,
        hasMoreAfter: data.hasMoreAfter,
        scrollTop,
      }),
    })
    this.emitPendingFollowBottomNeed(data)
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

  private startActiveFollowBottomIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
  ): ActiveFollowBottomIntent {
    this.followBottomCommandCounter += 1
    const intent = {
      feedId: data.feedId,
      generation: data.generation,
      commandId: `follow-bottom-${this.followBottomCommandCounter}`,
      lastScrollTop: scrollTop,
    }

    this.activeFollowBottomIntent = intent
    this.deps.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'followBottom.intent.start',
      correlationId: `command:${intent.commandId}`,
      details: () => ({
        revision: data.revision,
        itemCount: data.items.length,
        hasMoreAfter: data.hasMoreAfter,
        scrollTop,
      }),
    })
    return intent
  }

  // 确认已经存在一个追底意图，供 auto-scroll-to-bottom 这类数据事务复用。
  // 它不发起 latest 请求，只让后续 supersede/resize 后仍能继续追底。
  ensureActiveFollowBottomIntent(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
  ): ActiveFollowBottomIntent {
    if (this.hasActiveFollowBottomIntent(data)) {
      const intent = this.activeFollowBottomIntent as ActiveFollowBottomIntent
      intent.lastScrollTop = scrollTop
      return intent
    }

    return this.startActiveFollowBottomIntent(data, scrollTop)
  }

  private emitPendingFollowBottomNeed(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    const pending = this.pendingFollowBottom

    if (!pending || pending.emittedAfterRevision === data.revision) {
      return
    }

    pending.emittedAfterRevision = data.revision
    this.deps.edge.setAfterEdgeLatched(true)
    this.deps.emitEvent({
      type: 'needLatestMessages',
      feedId: data.feedId,
      generation: data.generation,
      reason: 'bottom-follow',
    })
  }

  private emitPendingDestinationNeed(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
  ): void {
    const pending = this.pendingDestinationRequest

    if (!pending || pending.emittedAfterRevision === data.revision) {
      return
    }

    pending.emittedAfterRevision = data.revision
    this.deps.emitEvent({
      type: 'needMessagesAround',
      feedId: data.feedId,
      generation: data.generation,
      reason: pending.intent,
      target: { ...pending.target },
    })
  }

  emitDestinationSettled(event: {
    intent: 'jump'
    target: MessageIdentityAnchor
    resolution: 'target' | 'fallback-deleted'
    resolvedTarget?: MessageIdentityAnchor
  }): void {
    const token = this.deps.getDataSnapshot()
      ? {
          feedId: this.deps.getDataSnapshot()!.feedId,
          generation: this.deps.getDataSnapshot()!.generation,
        }
      : this.deps.lifecycle.getCurrent()

    this.deps.emitEvent({
      type: 'destinationSettled',
      feedId: token.feedId,
      generation: token.generation,
      intent: event.intent,
      target: { ...event.target },
      resolution: event.resolution,
      resolvedTarget: event.resolvedTarget
        ? { ...event.resolvedTarget }
        : undefined,
    })
  }

  private hasCommittedMessage(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    messageId: string,
  ): boolean {
    return hasCommittedMessage(this.deps.renderWindow, data, messageId)
  }

  private resolvePendingJumpTarget(
    snapshot: MessageDataSnapshot<TMessage, TOptimistic>,
    target: MessageIdentityAnchor,
  ): MessageIdentityAnchor | null {
    return resolvePendingJumpTarget(this.deps.renderWindow, snapshot, target)
  }

  private shouldRebuildDestinationWindow(): boolean {
    const snapshot = this.deps.getViewportSnapshot()
    return (
      snapshot.topSpacer > DESTINATION_REBUILD_SPACER_THRESHOLD_PX ||
      snapshot.bottomSpacer > DESTINATION_REBUILD_SPACER_THRESHOLD_PX
    )
  }
}
