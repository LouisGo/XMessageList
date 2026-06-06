import type {
  MessageListMotionDirection,
  RuntimeScheduler,
  ScrollMotionEnabled,
  ScrollMotionOptions,
} from '../contracts/options'
import {
  ScrollMotionEngine,
  type ScrollMotionCancelReason,
  type ScrollMotionDecisionDiagnostic,
  type ScrollMotionRetargetDiagnostic,
  type ScrollMotionSource,
} from './scrollMotionEngine'

export type MotionState = 'idle' | 'reserved' | 'active'

export type MotionStartInput = {
  container: HTMLElement
  source: ScrollMotionSource
  targetTop: number
  allowPreposition?: boolean
  directionHint?: MessageListMotionDirection
  enforceDirectionHint?: boolean
  writeScrollTop: (scrollTop: number, source: ScrollMotionSource) => void
  onSettle: () => void
  onCancel: (reason: ScrollMotionCancelReason, source: ScrollMotionSource) => void
  onDiagnostic: (
    name: string,
    severity: 'debug' | 'info',
    details: Record<string, unknown>,
  ) => void
}

const DEFAULT_SCROLL_MOTION_OPTIONS: Required<ScrollMotionOptions> = {
  enabled: true,
  respectReducedMotion: true,
  maxDistancePx: 800,
  minDurationMs: 300,
  maxDurationMs: 600,
  targetEpsilonPx: 1,
}
const MIN_ANIMATED_DISTANCE_PX = 24

type NormalizedScrollMotionOptions = Omit<Required<ScrollMotionOptions>, 'enabled'> & {
  enabled: NonNullable<ScrollMotionOptions['enabled']>
}

/**
 * MotionCoordinator 把配置、reduced-motion、诊断和底层帧动画合并成一个 runtime-owned motion slot。
 */
export class MotionCoordinator {
  private readonly engine = new ScrollMotionEngine()

  private readonly options: NormalizedScrollMotionOptions

  private state: MotionState = 'idle'

  private activeSource: ScrollMotionSource | null = null

  constructor(
    private readonly scheduler: RuntimeScheduler,
    options: ScrollMotionOptions = {},
  ) {
    this.options = { ...DEFAULT_SCROLL_MOTION_OPTIONS, ...options }
  }

  getState(): MotionState {
    return this.state
  }

  isActive(): boolean {
    return this.engine.isActive()
  }

  reservePostCommitOpportunity(): void {
    this.state = 'reserved'
  }

  consumePostCommitOpportunity(): boolean {
    if (this.state === 'reserved') this.state = 'idle'
    return this.isActive()
  }

  start(input: MotionStartInput): boolean {
    this.cancel('restart')
    const targetTop = Math.max(0, input.targetTop)
    const currentTop = input.container.scrollTop
    const distancePx = targetTop - currentTop
    const rawDirection = resolveMotionDirection(currentTop, targetTop)
    const direction = input.enforceDirectionHint === true
      ? directionHintToMotionDirection(input.directionHint) ?? rawDirection
      : rawDirection

    if (
      !resolveMotionEnabled(this.options.enabled) ||
      isReducedMotionRequested(input.container, this.options)
    ) {
      // 关闭动画时仍走 settle 回调，保证 pendingIntent、bottom lock 和事件链保持一致。
      input.writeScrollTop(targetTop, input.source)
      input.onSettle()
      return false
    }

    if (Math.abs(distancePx) <= MIN_ANIMATED_DISTANCE_PX) {
      input.onDiagnostic('scrollMotion.decision', 'debug', {
        source: input.source,
        decision: 'tiny-settle',
        currentTop,
        targetTop,
        distancePx,
        thresholdPx: MIN_ANIMATED_DISTANCE_PX,
        direction,
        rawDirection,
        directionHint: input.directionHint ?? null,
        enforceDirectionHint: input.enforceDirectionHint === true,
      })
      input.writeScrollTop(targetTop, input.source)
      input.onSettle()
      return false
    }

    input.onDiagnostic('destinationMotion.start', 'info', {
      source: input.source,
      targetTop,
      currentTop,
      distancePx,
      direction,
      rawDirection,
      directionHint: input.directionHint ?? null,
      enforceDirectionHint: input.enforceDirectionHint === true,
      scrollHeight: input.container.scrollHeight,
      clientHeight: input.container.clientHeight,
    })

    this.state = 'active'
    this.activeSource = input.source
    const active = this.engine.start({
      container: input.container,
      source: input.source,
      targetTop,
      maxDistancePx: this.options.maxDistancePx,
      minDurationMs: this.options.minDurationMs,
      maxDurationMs: this.options.maxDurationMs,
      targetEpsilonPx: this.options.targetEpsilonPx,
      allowPreposition: input.allowPreposition,
      directionHint: input.directionHint,
      enforceDirectionHint: input.enforceDirectionHint,
      now: () => this.scheduler.now(),
      requestFrame: (callback) => this.scheduler.requestAnimationFrame(callback),
      cancelFrame: (handle) => this.scheduler.cancelAnimationFrame(handle),
      onFrameWrite: input.writeScrollTop,
      onSettle: () => {
        this.state = 'idle'
        this.activeSource = null
        input.onSettle()
      },
      onCancel: (reason) => {
        const source = this.activeSource ?? input.source
        this.state = 'idle'
        this.activeSource = null
        input.onCancel(reason, source)
      },
      onDecision: (decision) => {
        input.onDiagnostic('scrollMotion.decision', 'debug', {
          source: input.source,
          ...decisionToDetails(decision),
        })
      },
    })
    return active
  }

  cancel(reason: ScrollMotionCancelReason): void {
    if (!this.engine.isActive()) {
      this.state = 'idle'
      this.activeSource = null
      return
    }

    this.engine.cancel(reason)
  }

  retarget(targetTop: number, onDiagnostic: MotionStartInput['onDiagnostic']): boolean {
    return this.engine.retarget(targetTop, (decision) => {
      onDiagnostic('scrollMotion.retarget', 'debug', {
        source: this.activeSource,
        ...retargetDecisionToDetails(decision),
      })
    })
  }

  reset(): void {
    this.cancel('destroy')
    this.state = 'idle'
    this.activeSource = null
  }
}

function isReducedMotionRequested(
  container: HTMLElement,
  options: NormalizedScrollMotionOptions,
): boolean {
  if (!options.respectReducedMotion) return false
  return Boolean(
    container.ownerDocument.defaultView
      ?.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
}

function resolveMotionEnabled(enabled: ScrollMotionEnabled): boolean {
  return typeof enabled === 'function' ? enabled() : enabled
}

function resolveMotionDirection(currentTop: number, targetTop: number): 'up' | 'down' | 'none' {
  if (targetTop > currentTop) return 'down'
  if (targetTop < currentTop) return 'up'
  return 'none'
}

function directionHintToMotionDirection(
  directionHint: MessageListMotionDirection | undefined,
): 'up' | 'down' | null {
  if (directionHint === 'before') return 'up'
  if (directionHint === 'after') return 'down'
  return null
}

function decisionToDetails(
  decision: ScrollMotionDecisionDiagnostic,
): Record<string, unknown> {
  return decision
}

function retargetDecisionToDetails(
  decision: ScrollMotionRetargetDiagnostic,
): Record<string, unknown> {
  return decision
}

export type {
  ScrollMotionCancelReason,
  ScrollMotionSource,
}
