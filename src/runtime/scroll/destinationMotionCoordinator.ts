import {
  ScrollMotionEngine,
  type ScrollMotionCancelReason,
  type ScrollMotionSource,
} from './scrollMotionEngine'
import { ScrollIntentEngine } from './scrollIntentEngine'
import type { DomRegistry } from '../dom/domRegistry'
import type { ProjectionStore } from '../core/projectionStore'
import type { ProjectionCoordinator } from '../core/projectionCoordinator'
import type {
  MessageDataSnapshot,
  MessageViewportSnapshot,
  RuntimeScheduler,
  ScrollMotionOptions,
  ScrollSource,
  ViewportTransactionKind,
  ViewportAnchorChangeReason,
} from '../types'
import type {
  DestinationMotionForcedStart,
  DestinationMotionSettle,
  RuntimeDiagnosticEmitter,
  ReadySubstate,
} from '../core/runtimeTypes'

export type DestinationMotionCancelContext = {
  transactionKind?: ViewportTransactionKind
  transactionId?: string
}

export class DestinationMotionCoordinator<TMessage, TOptimistic> {
  private readonly motionEngine = new ScrollMotionEngine()

  private destinationMotionSettle:
    | DestinationMotionSettle<TMessage, TOptimistic>
    | null = null

  private cancelContext: DestinationMotionCancelContext | null = null

  constructor(
    private readonly registry: DomRegistry,
    private readonly store: ProjectionStore<TMessage, TOptimistic>,
    private readonly scheduler: RuntimeScheduler,
    private readonly scrollIntent: ScrollIntentEngine,
    private readonly projection: ProjectionCoordinator<TMessage, TOptimistic>,
    private readonly scrollMotionOptions: Required<ScrollMotionOptions>,
    private readonly setReadySubstate: (substate: ReadySubstate) => void,
    private readonly getCurrentFrame: () => number,
    private readonly isDestroyed: () => boolean,
    private readonly emitViewportAnchorChanged: (
      reason: ViewportAnchorChangeReason,
    ) => void,
    private readonly onDestinationMotionSettle: (
      settle: DestinationMotionSettle<TMessage, TOptimistic>,
    ) => void,
    private readonly onDestinationMotionSupersede: (
      settle: DestinationMotionSettle<TMessage, TOptimistic>,
      context: DestinationMotionCancelContext | null,
    ) => void,
    private readonly onScrollTopWritten: (
      scrollTop: number,
      source: ScrollSource,
    ) => void,
    private readonly emitDiagnostic: RuntimeDiagnosticEmitter,
  ) {}

  isActive(): boolean {
    return this.motionEngine.isActive()
  }

  start(input: {
    source: ScrollMotionSource
    targetTop: number
    data: MessageDataSnapshot<TMessage, TOptimistic>
    renderWindow: MessageViewportSnapshot<TMessage, TOptimistic>['renderWindow']
    bottomLockState: MessageViewportSnapshot['bottomLockState']
    forceAnimateFrom?: DestinationMotionForcedStart
    allowPreposition?: boolean
    destination?: DestinationMotionSettle<TMessage, TOptimistic>['destination']
  }): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    this.cancel('command-supersede')

    const targetTop = Math.max(0, input.targetTop)
    this.destinationMotionSettle = {
      source: input.source,
      targetTop,
      bottomLockState: input.bottomLockState,
      data: input.data,
      renderWindow: input.renderWindow,
      destination: input.destination,
    }

    const instantReason = this.getInstantDestinationMotionReason()
    const forcedStartTop =
      !instantReason
        ? this.getForcedStartTop(targetTop, input.forceAnimateFrom)
        : null
    const motionCorrelationId =
      `motion:${input.source}:${input.data.feedId}:${input.data.generation}:${input.data.revision}`
    this.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'destinationMotion.start',
      correlationId: motionCorrelationId,
      details: () => ({
        source: input.source,
        decision: instantReason ? 'instant' : 'engine',
        instantReason,
        currentTop: container.scrollTop,
        targetTop,
        distancePx: targetTop - container.scrollTop,
        forcedStartTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        enabled: this.scrollMotionOptions.enabled,
        respectReducedMotion: this.scrollMotionOptions.respectReducedMotion,
        reducedMotion: this.isReducedMotionRequested(),
      }),
    })

    // motion 完成前只暴露 MOTION_ACTIVE 阶段；最终 bottom lock 和 destinationSettled
    // 必须等真实 scrollTop 到达后再发布，避免动画过程中 UI 误判目的地已完成。
    if (instantReason) {
      this.writeScrollTop(targetTop, input.source)
      this.settleDestinationMotion()
      return
    }

    if (forcedStartTop !== null) {
      this.writeScrollTop(forcedStartTop, input.source)
    }

    this.setReadySubstate('READY_MOTION_ACTIVE')
    this.projection.publish({
      data: input.data,
      renderWindow: input.renderWindow,
      bootstrapState: this.store.getSnapshot().bootstrapState,
      bottomLockState: this.scrollIntent.getBottomLockState(),
      viewportPhase: 'MOTION_ACTIVE',
    })
    this.motionEngine.start({
      container,
      source: input.source,
      targetTop,
      maxDistancePx: this.scrollMotionOptions.maxDistancePx,
      minDurationMs: this.scrollMotionOptions.minDurationMs,
      maxDurationMs: this.scrollMotionOptions.maxDurationMs,
      targetEpsilonPx: this.scrollMotionOptions.targetEpsilonPx,
      allowPreposition: input.allowPreposition,
      now: () => this.scheduler.now(),
      requestFrame: (callback) => this.scheduler.requestAnimationFrame(callback),
      cancelFrame: (handle) => this.scheduler.cancelAnimationFrame(handle),
      onFrameWrite: (nextTop, source) => this.writeScrollTop(nextTop, source),
      onSettle: () => this.settleDestinationMotion(),
      onCancel: (reason) => this.handleDestinationMotionCancel(reason),
      onDecision: (decision) =>
        this.emitDiagnostic({
          channel: 'motion',
          severity: 'debug',
          name: 'scrollMotion.decision',
          correlationId: motionCorrelationId,
          details: () => ({
            source: input.source,
            ...decision,
          }),
        }),
    })
  }

  cancel(
    reason: ScrollMotionCancelReason,
    context: DestinationMotionCancelContext = {},
  ): void {
    if (!this.motionEngine.isActive()) {
      this.clearDestinationMotionSettle()
      return
    }

    this.cancelContext = context
    this.motionEngine.cancel(reason)
    this.cancelContext = null
  }

  getBottomTargetTop(container: HTMLElement): number {
    return Math.max(0, container.scrollHeight - container.clientHeight)
  }

  scrollToBottom(source: ScrollMotionSource): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    this.writeScrollTop(this.getBottomTargetTop(container), source)
  }

  scrollTo(source: ScrollMotionSource, targetTop: number): void {
    this.writeScrollTop(targetTop, source)
  }

  private getForcedStartTop(
    targetTop: number,
    forceAnimateFrom: DestinationMotionForcedStart | undefined,
  ): number | null {
    if (!forceAnimateFrom) {
      return null
    }

    if (forceAnimateFrom === 'beforeTarget') {
      return Math.max(0, targetTop - this.scrollMotionOptions.maxDistancePx)
    }

    return targetTop + this.scrollMotionOptions.maxDistancePx
  }

  writeScrollTop(nextScrollTop: number, source: ScrollSource): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    const scrollTop = Math.max(0, nextScrollTop)
    this.scrollIntent.markScrollWrite(source, this.getCurrentFrame())
    container.scrollTop = scrollTop
    this.onScrollTopWritten(scrollTop, source)
  }

  private settleDestinationMotion(): void {
    const settle = this.destinationMotionSettle

    if (!settle) {
      return
    }

    this.destinationMotionSettle = null
    this.setReadySubstate('READY_IDLE')
    this.scrollIntent.setBottomLockState(settle.bottomLockState)
    const container = this.registry.getContainer()
    this.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'destinationMotion.settle',
      correlationId:
        `motion:${settle.source}:${settle.data.feedId}:${settle.data.generation}:${settle.data.revision}`,
      details: () => ({
        source: settle.source,
        targetTop: settle.targetTop,
        scrollTop: container?.scrollTop ?? null,
        distancePx: container ? settle.targetTop - container.scrollTop : null,
        bottomLockState: settle.bottomLockState,
      }),
    })
    this.onDestinationMotionSettle(settle)
    // 到达目的地后再发布最终 bottomLockState，外部看到的状态才与真实 scrollTop 一致。
    this.projection.publish({
      data: settle.data,
      renderWindow: settle.renderWindow,
      bootstrapState: this.store.getSnapshot().bootstrapState,
      bottomLockState: settle.bottomLockState,
      viewportPhase: 'IDLE',
    })
    this.emitViewportAnchorChanged('transaction-settle')
  }

  private clearDestinationMotionSettle(): void {
    const settle = this.destinationMotionSettle

    if (!settle) {
      return
    }

    this.destinationMotionSettle = null
    this.setReadySubstate('READY_IDLE')
    this.projection.publish({
      data: settle.data,
      renderWindow: settle.renderWindow,
      bootstrapState: this.store.getSnapshot().bootstrapState,
      bottomLockState: this.scrollIntent.getBottomLockState(),
      viewportPhase: 'IDLE',
    })
  }

  private handleDestinationMotionCancel(reason: ScrollMotionCancelReason): void {
    const settle = this.destinationMotionSettle
    const container = this.registry.getContainer()
    const context = this.cancelContext

    this.emitDiagnostic({
      channel: 'motion',
      severity: reason === 'user-interrupt' ? 'info' : 'debug',
      name: 'destinationMotion.cancel',
      correlationId: settle
        ? `motion:${settle.source}:${settle.data.feedId}:${settle.data.generation}:${settle.data.revision}`
        : undefined,
      details: () => ({
        source: settle?.source ?? null,
        reason,
        targetTop: settle?.targetTop ?? null,
        scrollTop: container?.scrollTop ?? null,
        distancePx:
          settle && container ? settle.targetTop - container.scrollTop : null,
        transactionKind: context?.transactionKind ?? null,
        transactionId: context?.transactionId ?? null,
      }),
    })

    this.clearDestinationMotionSettle()

    if (!settle || this.isDestroyed()) {
      return
    }

    if (
      reason === 'transaction-supersede' &&
      settle.source === 'jump' &&
      settle.destination
    ) {
      // Data/resize transactions invalidate the measured target coordinate,
      // but not the user's jump intent. Re-resolve after the superseding
      // transaction commits; do not emit destinationSettled from a partial move.
      this.onDestinationMotionSupersede(settle, context)
      return
    }

    if (reason !== 'user-interrupt' && reason !== 'resize-during-motion') {
      return
    }

    const bottomLockState =
      reason === 'resize-during-motion' ? settle.bottomLockState : 'UNLOCKED'

    // 用户打断表示放弃目的地；resize 打断只是坐标失效，仍保留原事务期望的 lock 语义。
    this.scrollIntent.setBottomLockState(bottomLockState)
    this.projection.publish({
      data: settle.data,
      renderWindow: settle.renderWindow,
      bootstrapState: this.store.getSnapshot().bootstrapState,
      bottomLockState,
      viewportPhase: 'IDLE',
    })
  }

  private getInstantDestinationMotionReason():
    | 'disabled'
    | 'reduced-motion'
    | null {
    if (!this.scrollMotionOptions.enabled) {
      return 'disabled'
    }

    if (!this.scrollMotionOptions.respectReducedMotion) {
      return null
    }

    return this.isReducedMotionRequested() ? 'reduced-motion' : null
  }

  private isReducedMotionRequested(): boolean {
    const ownerWindow = this.registry.getContainer()?.ownerDocument.defaultView
    return Boolean(
      ownerWindow
        ?.matchMedia?.('(prefers-reduced-motion: reduce)')
        .matches,
    )
  }
}
