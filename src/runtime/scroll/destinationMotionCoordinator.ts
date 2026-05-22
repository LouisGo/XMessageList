import {
  ScrollMotionEngine,
  type ScrollMotionCancelReason,
  type ScrollMotionSource,
} from './scrollMotionEngine'
import { ScrollIntentEngine } from './scrollIntentEngine'
import type { DomRegistry } from '../dom/domRegistry'
import type { ProjectionStore } from '../core/state/projectionStore'
import type { ProjectionCoordinator } from '../core/projection/projectionCoordinator'
import type {
  MessageDataSnapshot,
  MessageViewportSnapshot,
  RuntimeScheduler,
  ScrollMotionOptions,
  ScrollSource,
  DestinationState,
  ViewportAnchorChangeReason,
} from '../types'
import type {
  DestinationMotionForcedStart,
  DestinationMotionSettle,
  RuntimeDiagnosticEmitter,
  ReadySubstate,
} from '../core/state/runtimeTypes'
import {
  createDestinationMotionCorrelationId,
  emitDestinationMotionStartDiagnostic,
} from './destinationMotionDiagnostics'
import {
  applyDestinationMotionCancel,
  type DestinationMotionCancelContext,
} from './destinationMotionCancel'
import {
  getForcedDestinationStartTop,
  getInstantDestinationMotionReason,
} from './destinationMotionPolicy'
import { startDestinationScrollMotion } from './destinationMotionRunner'

export type { DestinationMotionCancelContext } from './destinationMotionCancel'

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
    private readonly setDestinationState: (state: DestinationState) => void,
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

    const instantReason = getInstantDestinationMotionReason(
      this.scrollMotionOptions,
      container,
    )
    const forcedStartTop =
      !instantReason
        ? getForcedDestinationStartTop(
            targetTop,
            input.forceAnimateFrom,
            this.scrollMotionOptions.maxDistancePx,
          )
        : null
    const motionCorrelationId =
      createDestinationMotionCorrelationId(input.source, input.data)
    emitDestinationMotionStartDiagnostic({
      emitDiagnostic: this.emitDiagnostic,
      source: input.source,
      data: input.data,
      container,
      targetTop,
      forcedStartTop,
      instantReason,
      options: this.scrollMotionOptions,
      correlationId: motionCorrelationId,
    })

    // motion 完成前只暴露 MOTION_ACTIVE 阶段；最终 bottom lock 和 destinationSettled
    // 必须等真实 scrollTop 到达后再发布，避免动画过程中 UI 误判目的地已完成。
    if (instantReason) {
      this.setDestinationState('motionActive')
      this.writeScrollTop(targetTop, input.source)
      this.settleDestinationMotion()
      return
    }

    if (forcedStartTop !== null) {
      this.writeScrollTop(forcedStartTop, input.source)
    }

    this.setReadySubstate('READY_MOTION_ACTIVE')
    this.setDestinationState('motionActive')
    this.projection.publish({
      data: input.data,
      renderWindow: input.renderWindow,
      bootstrapState: this.store.getSnapshot().bootstrapState,
      bottomLockState: this.scrollIntent.getBottomLockState(),
      viewportPhase: 'MOTION_ACTIVE',
    })
    startDestinationScrollMotion({
      motionEngine: this.motionEngine,
      container,
      source: input.source,
      targetTop,
      options: this.scrollMotionOptions,
      allowPreposition: input.allowPreposition,
      scheduler: this.scheduler,
      correlationId: motionCorrelationId,
      writeScrollTop: (nextTop, source) => this.writeScrollTop(nextTop, source),
      settle: () => this.settleDestinationMotion(),
      cancel: (reason) => this.handleDestinationMotionCancel(reason),
      emitDiagnostic: this.emitDiagnostic,
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
    this.setDestinationState('settled')
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
    this.setDestinationState('idle')
    this.projection.publish({
      data: settle.data,
      renderWindow: settle.renderWindow,
      bootstrapState: this.store.getSnapshot().bootstrapState,
      bottomLockState: this.scrollIntent.getBottomLockState(),
      viewportPhase: 'IDLE',
    })
  }

  private handleDestinationMotionCancel(reason: ScrollMotionCancelReason): void {
    applyDestinationMotionCancel({
      reason,
      settle: this.destinationMotionSettle,
      container: this.registry.getContainer(),
      context: this.cancelContext,
      isDestroyed: this.isDestroyed,
      store: this.store,
      scrollIntent: this.scrollIntent,
      projection: this.projection,
      setDestinationState: this.setDestinationState,
      clearDestinationMotionSettle: () => this.clearDestinationMotionSettle(),
      onDestinationMotionSupersede: this.onDestinationMotionSupersede,
      emitDiagnostic: this.emitDiagnostic,
    })
  }

}
