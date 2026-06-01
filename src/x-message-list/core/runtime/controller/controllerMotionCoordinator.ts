import type { MessageIdentityAnchor } from '../contracts/identity'
import type { MessageListScrollMotionHint, RuntimeScheduler, ScrollMotionOptions } from '../contracts/options'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { ViewportDiagnosticRecord, ViewportObservationReason } from '../contracts/events'
import type { RuntimeMeasurement } from '../dom/measurement'
import type { DestinationIntent } from '../interactions/interactionState'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'
import { MotionCoordinator, type ScrollMotionCancelReason, type ScrollMotionSource } from '../motion/motionCoordinator'
import type { TransactionScrollResolution } from '../transactions/transactionSettlement'

type MotionResolution = Extract<TransactionScrollResolution, { kind: 'motion' }>

type MotionHost<TMessage, TOptimistic> = {
  stateAxes: RuntimeStateAxes
  getSnapshot: () => MessageListSnapshot<TMessage, TOptimistic>
  setSnapshot: (snapshot: MessageListSnapshot<TMessage, TOptimistic>) => void
  emitSnapshot: () => void
  getScrollContainer: () => HTMLElement | null
  getBottomTargetTop: () => number | null
  resolveAlignedScrollTarget: (
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    target: MessageIdentityAnchor,
    align: DestinationIntent['align'],
    offsetWithinMessage?: number,
  ) => { container: HTMLElement; scrollTop: number } | null
  writeProgrammaticScroll: (
    container: HTMLElement,
    scrollTop: number,
    source: ScrollSource,
  ) => void
  measureRuntimeDom: () => RuntimeMeasurement
  recordRowMetrics: () => void
  setViewportPhase: (phase: MessageListSnapshot['viewportPhase']) => void
  syncScrollIntentBottomLock: () => void
  clearFollowBottom: () => void
  markLocalDestinationSettled: () => void
  readCurrentScrollTop: () => number
  pushDiagnostic: (
    name: string,
    severity: ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ) => void
  emitViewportObservation: (
    reason: ViewportObservationReason,
    scrollSource: ScrollSource,
    anchor: MessageIdentityAnchor | null,
  ) => void
  emitAnchorChanged: (
    reason: 'transaction-settle',
    anchor: MessageIdentityAnchor | null,
  ) => void
  emitDestinationSettled: (
    destination: DestinationIntent,
    resolvedTarget: MessageIdentityAnchor | null,
  ) => void
  applyPostCommitInteractionUpdates: () => void
}

/**
 * ControllerMotionCoordinator 是 controller 和 motion engine 的隔离层，负责把 motion settle/cancel 写回 snapshot 与 runtime events。
 */
export class ControllerMotionCoordinator<TMessage, TOptimistic> {
  private readonly motion: MotionCoordinator

  constructor(input: {
    scheduler: RuntimeScheduler
    options?: ScrollMotionOptions
    host: MotionHost<TMessage, TOptimistic>
  }) {
    this.motion = new MotionCoordinator(input.scheduler, input.options)
    this.host = input.host
  }

  private readonly host: MotionHost<TMessage, TOptimistic>

  reservePostCommitOpportunity(): void {
    this.motion.reservePostCommitOpportunity()
  }

  consumePostCommitOpportunity(): boolean {
    return this.motion.consumePostCommitOpportunity()
  }

  reset(): void {
    this.motion.reset()
  }

  cancel(reason: ScrollMotionCancelReason): void {
    this.motion.cancel(reason)
  }

  alignLocalDestination(
    target: MessageIdentityAnchor,
    align: DestinationIntent['align'],
    offsetWithinMessage: number | undefined,
    reason: DestinationIntent['reason'],
    motion?: MessageListScrollMotionHint,
  ): boolean {
    const resolved = this.host.resolveAlignedScrollTarget(
      this.host.getSnapshot(),
      target,
      align,
      offsetWithinMessage,
    )

    if (!resolved) {
      return false
    }

    this.host.clearFollowBottom()
    this.host.markLocalDestinationSettled()
    this.host.setSnapshot({
      ...this.host.getSnapshot(),
      bottomLockState: 'UNLOCKED',
      pendingIntent: null,
    })
    this.host.syncScrollIntentBottomLock()
    this.host.emitSnapshot()
    const destination = { target, align, offsetWithinMessage, reason, motion }

    if (
      reason === 'jump' &&
      this.startResolution({
        kind: 'motion',
        source: 'jump',
        targetTop: resolved.scrollTop,
        anchor: target,
        bottomLockState: 'UNLOCKED',
        destination,
        allowPreposition: !motion?.crossFeed,
        directionHint: resolveMotionDirectionHint(motion),
      }, 'jump')
    ) {
      return true
    }

    this.host.writeProgrammaticScroll(
      resolved.container,
      resolved.scrollTop,
      reason === 'jump' ? 'jump' : 'programmatic',
    )
    this.host.emitAnchorChanged('transaction-settle', target)
    this.host.emitDestinationSettled(destination, target)
    return true
  }

  startBottom(
    source: Extract<ScrollMotionSource, 'programmatic' | 'followBottom'>,
    anchor: MessageIdentityAnchor | null,
  ): boolean {
    const targetTop = this.host.getBottomTargetTop()
    if (targetTop === null) return false
    return this.startResolution({
      kind: 'motion',
      source,
      targetTop,
      anchor,
      bottomLockState: 'LOCKED',
      destination: null,
      directionHint: source === 'followBottom' ? 'after' : undefined,
    }, source)
  }

  startResolution(
    resolution: MotionResolution,
    scrollSource: ScrollSource | null,
  ): boolean {
    const container = this.host.getScrollContainer()
    if (!container) return false
    this.cancel('restart')
    // queued transaction drain 后再启动 motion 时，目标 DOM 位置可能已经变化，需要以当前 DOM 重新解析。
    const targetTop = this.resolveCurrentTargetTop(resolution)
    this.host.stateAxes.markMotionActive()
    this.host.stateAxes.markDestinationMotionActive()
    this.host.setViewportPhase('MOTION')
    this.motion.start({
      container,
      source: resolution.source,
      targetTop,
      allowPreposition: resolution.allowPreposition,
      directionHint: resolution.directionHint,
      enforceDirectionHint: resolution.enforceDirectionHint,
      writeScrollTop: (scrollTop, source) =>
        this.host.writeProgrammaticScroll(container, scrollTop, source),
      onSettle: () => this.finish(resolution, scrollSource ?? resolution.source, targetTop),
      onCancel: (reason, source) => this.handleCancel(reason, source),
      onDiagnostic: (name, severity, details) =>
        this.host.pushDiagnostic(name, severity, details),
    })
    return true
  }

  private resolveCurrentTargetTop(resolution: MotionResolution): number {
    if (resolution.destination && resolution.anchor) {
      return this.host.resolveAlignedScrollTarget(
        this.host.getSnapshot(),
        resolution.anchor,
        resolution.destination.align,
        resolution.destination.offsetWithinMessage,
      )?.scrollTop ?? resolution.targetTop
    }

    if (!resolution.destination) {
      return this.host.getBottomTargetTop() ?? resolution.targetTop
    }

    return resolution.targetTop
  }

  private finish(
    resolution: MotionResolution,
    scrollSource: ScrollSource,
    targetTop: number,
  ): void {
    this.host.measureRuntimeDom()
    this.host.recordRowMetrics()
    this.host.setSnapshot({
      ...this.host.getSnapshot(),
      bottomLockState: resolution.bottomLockState,
      pendingIntent: null,
    })
    if (resolution.source === 'followBottom') {
      this.host.clearFollowBottom()
    }
    this.host.stateAxes.markReadyIdle()
    this.host.stateAxes.markDestinationSettled()
    this.host.syncScrollIntentBottomLock()
    this.host.setViewportPhase('IDLE')
    this.host.pushDiagnostic('destinationMotion.settle', 'info', {
      source: resolution.source,
      targetTop,
      scrollTop: this.host.readCurrentScrollTop(),
      bottomLockState: resolution.bottomLockState,
    })
    this.host.emitViewportObservation('transaction-settle', scrollSource, resolution.anchor)
    this.host.emitAnchorChanged('transaction-settle', resolution.anchor)
    if (resolution.destination) {
      this.host.emitDestinationSettled(resolution.destination, resolution.anchor)
    }
    this.host.applyPostCommitInteractionUpdates()
  }

  private handleCancel(
    reason: ScrollMotionCancelReason,
    source: ScrollMotionSource,
  ): void {
    this.host.pushDiagnostic('destinationMotion.cancel', 'info', {
      reason,
      source,
      scrollTop: this.host.readCurrentScrollTop(),
    })

    if (this.host.getSnapshot().viewportPhase !== 'MOTION') {
      return
    }

    this.host.stateAxes.markReadyIdle()
    if (
      reason === 'transaction-supersede' ||
      reason === 'restart'
    ) {
      return
    }

    if (reason === 'user-interrupt') {
      this.host.stateAxes.markDestinationInterrupted()
      this.host.clearFollowBottom()
      this.host.setSnapshot({
        ...this.host.getSnapshot(),
        bottomLockState: 'UNLOCKED',
        pendingIntent: null,
      })
      this.host.syncScrollIntentBottomLock()
    }
    this.host.setViewportPhase('IDLE')
  }
}

export type {
  ScrollMotionCancelReason,
}

function resolveMotionDirectionHint(
  motion: MessageListScrollMotionHint | undefined,
): MessageListScrollMotionHint['direction'] {
  return motion?.crossFeed ? undefined : motion?.direction
}
