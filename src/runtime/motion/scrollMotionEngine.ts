import type { MessageListMotionDirection, RuntimeScheduler } from '../contracts/options'
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
  directionHint?: MessageListMotionDirection
  enforceDirectionHint?: boolean
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
      directionHint: MessageListMotionDirection | null
      enforceDirectionHint: boolean
    }
  | {
      decision: 'bounded-animate'
      currentTop: number
      targetTop: number
      distancePx: number
      epsilonPx: number
      maxDistancePx: number
      prepositionTop: number | null
      semanticPrepositionTop: number | null
      startTop: number
      remainingDistancePx: number
      durationMs: number
      directionHint: MessageListMotionDirection | null
      enforceDirectionHint: boolean
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

/**
 * ScrollMotionEngine 只处理可取消的 bounded scrollTop 动画；它不理解 pendingIntent 或 viewport 状态。
 */
export class ScrollMotionEngine {
  private active: ActiveMotion | null = null

  private nextMotionId = 1

  start(input: ScrollMotionStart): void {
    this.cancel('restart')
    const targetTop = Math.max(0, input.targetTop)
    const currentTop = input.container.scrollTop
    const epsilon = input.targetEpsilonPx || 1
    const distancePx = targetTop - currentTop
    const maxDistancePx = Math.max(1, input.maxDistancePx)
    let startTop = currentTop
    let prepositionTop: number | null = null
    let semanticPrepositionTop: number | null = null
    const directionHint = input.directionHint ?? null
    const enforceDirectionHint = input.enforceDirectionHint === true

    if (input.allowPreposition !== false && enforceDirectionHint) {
      semanticPrepositionTop = resolveSemanticPrepositionTop({
        container: input.container,
        currentTop,
        targetTop,
        distancePx,
        epsilon,
        maxDistancePx,
        directionHint,
      })
      if (semanticPrepositionTop !== null) {
        startTop = semanticPrepositionTop
        prepositionTop = semanticPrepositionTop
        input.onFrameWrite(startTop, input.source)
      }
    }

    if (Math.abs(targetTop - startTop) <= epsilon) {
      input.onDecision?.({
        decision: 'epsilon-settle',
        currentTop,
        targetTop,
        distancePx,
        epsilonPx: epsilon,
        directionHint,
        enforceDirectionHint,
      })
      input.onSettle()
      return
    }

    const id = this.nextMotionId
    this.nextMotionId += 1

    if (
      prepositionTop === null &&
      input.allowPreposition !== false &&
      Math.abs(distancePx) > maxDistancePx
    ) {
      // 远距离跳转先贴近目标再动画，避免长列表上出现过长、不可控的滚动过程。
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
      semanticPrepositionTop,
      startTop,
      remainingDistancePx: remainingDistance,
      durationMs,
      directionHint,
      enforceDirectionHint,
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

function resolveSemanticPrepositionTop(input: {
  container: HTMLElement
  currentTop: number
  targetTop: number
  distancePx: number
  epsilon: number
  maxDistancePx: number
  directionHint: MessageListMotionDirection | null
}): number | null {
  const directionSign = directionHintToSign(input.directionHint)
  if (directionSign === null) return null
  if (
    Math.abs(input.distancePx) > input.epsilon &&
    Math.sign(input.distancePx) === directionSign
  ) {
    return null
  }

  const maxScrollTop = Math.max(0, input.container.scrollHeight - input.container.clientHeight)
  const availableDistance = directionSign > 0
    ? input.targetTop
    : maxScrollTop - input.targetTop
  const semanticDistance = Math.min(input.maxDistancePx, Math.max(0, availableDistance))
  if (semanticDistance <= input.epsilon) return null

  return input.targetTop - directionSign * semanticDistance
}

function directionHintToSign(
  directionHint: MessageListMotionDirection | null,
): 1 | -1 | null {
  if (directionHint === 'after') return 1
  if (directionHint === 'before') return -1
  return null
}

function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5
}
