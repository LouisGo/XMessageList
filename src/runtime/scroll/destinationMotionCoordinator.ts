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
  ViewportAnchorChangeReason,
} from '../types'
import type {
  DestinationMotionSettle,
  ReadySubstate,
} from '../core/runtimeTypes'

export class DestinationMotionCoordinator<TMessage, TOptimistic> {
  private readonly motionEngine = new ScrollMotionEngine()

  private destinationMotionSettle:
    | DestinationMotionSettle<TMessage, TOptimistic>
    | null = null

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
  }): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    this.cancel('command-supersede')

    const targetTop = Math.max(0, input.targetTop)
    this.destinationMotionSettle = {
      source: input.source,
      bottomLockState: input.bottomLockState,
      data: input.data,
      renderWindow: input.renderWindow,
    }

    // motion 完成前先暂存最终 projection 状态，避免动画中途就暴露 LOCKED / jump 完成。
    if (this.shouldUseInstantDestinationMotion()) {
      this.writeScrollTop(targetTop, input.source)
      this.settleDestinationMotion()
      return
    }

    this.setReadySubstate('READY_MOTION_ACTIVE')
    this.motionEngine.start({
      container,
      source: input.source,
      targetTop,
      maxDistancePx: this.scrollMotionOptions.maxDistancePx,
      minDurationMs: this.scrollMotionOptions.minDurationMs,
      maxDurationMs: this.scrollMotionOptions.maxDurationMs,
      targetEpsilonPx: this.scrollMotionOptions.targetEpsilonPx,
      now: () => this.scheduler.now(),
      requestFrame: (callback) => this.scheduler.requestAnimationFrame(callback),
      cancelFrame: (handle) => this.scheduler.cancelAnimationFrame(handle),
      onFrameWrite: (nextTop, source) => this.writeScrollTop(nextTop, source),
      onSettle: () => this.settleDestinationMotion(),
      onCancel: (reason) => this.handleDestinationMotionCancel(reason),
    })
  }

  cancel(reason: ScrollMotionCancelReason): void {
    if (!this.motionEngine.isActive()) {
      this.clearDestinationMotionSettle()
      return
    }

    this.motionEngine.cancel(reason)
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

  writeScrollTop(nextScrollTop: number, source: ScrollSource): void {
    const container = this.registry.getContainer()

    if (!container) {
      return
    }

    this.scrollIntent.markScrollWrite(source, this.getCurrentFrame())
    container.scrollTop = Math.max(0, nextScrollTop)
  }

  private settleDestinationMotion(): void {
    const settle = this.destinationMotionSettle

    if (!settle) {
      return
    }

    this.destinationMotionSettle = null
    this.setReadySubstate('READY_IDLE')
    this.scrollIntent.setBottomLockState(settle.bottomLockState)
    // 到达目的地后再发布最终 bottomLockState，外部看到的状态才与真实 scrollTop 一致。
    this.projection.publish({
      data: settle.data,
      renderWindow: settle.renderWindow,
      bootstrapState: this.store.getSnapshot().bootstrapState,
      bottomLockState: settle.bottomLockState,
    })
    this.emitViewportAnchorChanged('transaction-settle')
  }

  private clearDestinationMotionSettle(): void {
    if (!this.destinationMotionSettle) {
      return
    }

    this.destinationMotionSettle = null
    this.setReadySubstate('READY_IDLE')
  }

  private handleDestinationMotionCancel(reason: ScrollMotionCancelReason): void {
    const settle = this.destinationMotionSettle

    this.clearDestinationMotionSettle()

    if (!settle || this.isDestroyed()) {
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
    })
  }

  private shouldUseInstantDestinationMotion(): boolean {
    if (!this.scrollMotionOptions.enabled) {
      return true
    }

    if (!this.scrollMotionOptions.respectReducedMotion) {
      return false
    }

    const ownerWindow = this.registry.getContainer()?.ownerDocument.defaultView
    return Boolean(
      ownerWindow
        ?.matchMedia?.('(prefers-reduced-motion: reduce)')
        .matches,
    )
  }
}
