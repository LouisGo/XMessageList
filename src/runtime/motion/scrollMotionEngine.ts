import type { RuntimeScheduler } from '../contracts/options'
import type { ScrollSource } from '../scroll/scrollIntentEngine'

export type ScrollMotionSource = Extract<
  ScrollSource,
  'programmatic' | 'followBottom' | 'jump'
>

export type ScrollMotionCancelReason =
  | 'restart'
  | 'transaction-supersede'
  | 'command-supersede'
  | 'user-interrupt'
  | 'generation-change'
  | 'detach'
  | 'destroy'
  | 'commit-timeout'
  | 'resize-during-motion'
  | 'target-missing'

export type ScrollMotionStart = {
  container: HTMLElement
  source: ScrollMotionSource
  targetTop: number
  maxDistancePx: number
  minDurationMs: number
  maxDurationMs: number
  targetEpsilonPx: number
  allowPreposition?: boolean
  now: RuntimeScheduler['now']
  requestFrame: RuntimeScheduler['requestAnimationFrame']
  cancelFrame: RuntimeScheduler['cancelAnimationFrame']
  onFrameWrite: (nextTop: number, source: ScrollMotionSource) => void
  onSettle: () => void
  onCancel: (reason: ScrollMotionCancelReason) => void
  onDecision?: (decision: ScrollMotionDecisionDiagnostic) => void
}

export type ScrollMotionDecisionDiagnostic =
  | {
      decision: 'epsilon-settle'
      currentTop: number
      targetTop: number
      distancePx: number
      epsilonPx: number
    }
  | {
      decision: 'bounded-animate'
      currentTop: number
      targetTop: number
      distancePx: number
      epsilonPx: number
      maxDistancePx: number
      prepositionTop: number | null
      startTop: number
      remainingDistancePx: number
      durationMs: number
    }

type ActiveMotion = {
  id: number
  frameId: number | null
  targetTop: number
  startedAt: number
  startTop: number
  durationMs: number
  input: ScrollMotionStart
}

export class ScrollMotionEngine {
  private active: ActiveMotion | null = null

  private nextMotionId = 1

  start(input: ScrollMotionStart): void {
    this.cancel('restart')
    const targetTop = Math.max(0, input.targetTop)
    const currentTop = input.container.scrollTop
    const epsilon = input.targetEpsilonPx || 1
    const distancePx = targetTop - currentTop

    if (Math.abs(distancePx) <= epsilon) {
      input.onDecision?.({ decision: 'epsilon-settle', currentTop, targetTop, distancePx, epsilonPx: epsilon })
      input.onSettle()
      return
    }

    const id = this.nextMotionId
    this.nextMotionId += 1
    const maxDistancePx = Math.max(1, input.maxDistancePx)
    let startTop = currentTop
    let prepositionTop: number | null = null

    if (input.allowPreposition !== false && Math.abs(distancePx) > maxDistancePx) {
      startTop = targetTop - Math.sign(distancePx) * maxDistancePx
      prepositionTop = startTop
      input.onFrameWrite(startTop, input.source)
    }

    const remainingDistance = Math.abs(targetTop - startTop)
    const durationMs = computeDuration({
      distancePx: remainingDistance,
      maxDistancePx,
      minDurationMs: input.minDurationMs,
      maxDurationMs: input.maxDurationMs,
    })
    input.onDecision?.({
      decision: 'bounded-animate',
      currentTop,
      targetTop,
      distancePx,
      epsilonPx: epsilon,
      maxDistancePx,
      prepositionTop,
      startTop,
      remainingDistancePx: remainingDistance,
      durationMs,
    })
    const active: ActiveMotion = {
      id,
      frameId: null,
      targetTop,
      startedAt: input.now(),
      startTop,
      durationMs,
      input,
    }

    this.active = active
    active.frameId = input.requestFrame((time) => this.step(id, time))
  }

  cancel(reason: ScrollMotionCancelReason): void {
    const active = this.active
    if (!active) return
    this.active = null
    if (active.frameId !== null) active.input.cancelFrame(active.frameId)
    active.input.onCancel(reason)
  }

  isActive(): boolean {
    return this.active !== null
  }

  private step(id: number, time: DOMHighResTimeStamp): void {
    const active = this.active
    if (!active || active.id !== id) return
    const elapsed = Math.max(0, time - active.startedAt)
    const progress = active.durationMs <= 0 ? 1 : Math.min(1, elapsed / active.durationMs)
    const nextTop = active.startTop + (active.targetTop - active.startTop) * easeOutQuint(progress)
    active.input.onFrameWrite(nextTop, active.input.source)

    if (progress >= 1 || Math.abs(active.targetTop - nextTop) <= active.input.targetEpsilonPx) {
      this.active = null
      active.frameId = null
      active.input.onFrameWrite(active.targetTop, active.input.source)
      active.input.onSettle()
      return
    }

    active.frameId = active.input.requestFrame((nextTime) => this.step(id, nextTime))
  }
}

function computeDuration(input: {
  distancePx: number
  maxDistancePx: number
  minDurationMs: number
  maxDurationMs: number
}): number {
  const minDurationMs = Math.max(0, input.minDurationMs)
  const maxDurationMs = Math.max(minDurationMs, input.maxDurationMs)
  const ratio = Math.min(1, input.distancePx / input.maxDistancePx)
  return minDurationMs + (maxDurationMs - minDurationMs) * ratio
}

function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5
}
