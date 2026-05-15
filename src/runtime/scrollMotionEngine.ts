import type { RuntimeScheduler, ScrollSource } from './types'

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
  now: RuntimeScheduler['now']
  requestFrame: RuntimeScheduler['requestAnimationFrame']
  cancelFrame: RuntimeScheduler['cancelAnimationFrame']
  onFrameWrite: (nextTop: number, source: ScrollMotionSource) => void
  onSettle: () => void
  onCancel: (reason: ScrollMotionCancelReason) => void
}

type ActiveMotion = {
  id: number
  source: ScrollMotionSource
  frameId: number | null
  targetTop: number
  startedAt: number
  startTop: number
  durationMs: number
  input: ScrollMotionStart
}

const DEFAULT_EPSILON_PX = 1

/**
 * ScrollMotionEngine 是唯一的 animated scrollTop writer。
 * 它不读 row DOM、不发布 projection，只按 bounded target 写入容器滚动位置。
 */
export class ScrollMotionEngine {
  private active: ActiveMotion | null = null

  private nextMotionId = 1

  start(input: ScrollMotionStart): void {
    this.cancel('restart')

    const targetTop = Math.max(0, input.targetTop)
    const currentTop = input.container.scrollTop
    const epsilon = input.targetEpsilonPx || DEFAULT_EPSILON_PX

    if (Math.abs(targetTop - currentTop) <= epsilon) {
      input.onSettle()
      return
    }

    const id = this.nextMotionId
    this.nextMotionId += 1
    let startTop = currentTop
    const maxDistancePx = Math.max(1, input.maxDistancePx)
    const initialDistance = targetTop - currentTop

    if (Math.abs(initialDistance) > maxDistancePx) {
      startTop =
        targetTop - Math.sign(initialDistance) * maxDistancePx
      input.onFrameWrite(startTop, input.source)
    }

    const remainingDistance = Math.abs(targetTop - startTop)
    const durationMs = this.computeDuration({
      distancePx: remainingDistance,
      maxDistancePx,
      minDurationMs: input.minDurationMs,
      maxDurationMs: input.maxDurationMs,
    })

    const active: ActiveMotion = {
      id,
      source: input.source,
      frameId: null,
      targetTop,
      startedAt: input.now(),
      startTop,
      durationMs,
      input,
    }

    this.active = active
    active.frameId = input.requestFrame((time) => {
      this.step(id, time)
    })
  }

  cancel(reason: ScrollMotionCancelReason): void {
    const active = this.active

    if (!active) {
      return
    }

    this.active = null

    if (active.frameId !== null) {
      active.input.cancelFrame(active.frameId)
    }

    active.input.onCancel(reason)
  }

  isActive(): boolean {
    return this.active !== null
  }

  adjustTarget(deltaPx: number): void {
    const active = this.active

    if (!active || Math.abs(deltaPx) <= 0.5) {
      return
    }

    active.targetTop = Math.max(0, active.targetTop + deltaPx)
  }

  private step(id: number, time: DOMHighResTimeStamp): void {
    const active = this.active

    if (!active || active.id !== id) {
      return
    }

    const elapsed = Math.max(0, time - active.startedAt)
    const progress =
      active.durationMs <= 0 ? 1 : Math.min(1, elapsed / active.durationMs)
    const eased = easeOutQuint(progress)
    const nextTop =
      active.startTop + (active.targetTop - active.startTop) * eased

    active.input.onFrameWrite(nextTop, active.source)

    if (
      progress >= 1 ||
      Math.abs(active.targetTop - active.input.container.scrollTop) <=
        active.input.targetEpsilonPx
    ) {
      this.active = null
      active.frameId = null
      active.input.onFrameWrite(active.targetTop, active.source)
      active.input.onSettle()
      return
    }

    active.frameId = active.input.requestFrame((nextTime) => {
      this.step(id, nextTime)
    })
  }

  private computeDuration(input: {
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
}

function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5
}
