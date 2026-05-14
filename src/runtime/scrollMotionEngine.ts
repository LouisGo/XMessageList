import type { ActiveMotion, ScrollMotionCancelReason, ScrollMotionStart } from './types'
import { easeOutQuint } from './utils'

const TARGET_EPSILON_PX = 1

let motionIdCounter = 0

export class ScrollMotionEngine {
  private active: ActiveMotion | null = null

  private activeCancelFrame: ((handle: number) => void) | null = null

  private activeOnSettle: (() => void) | null = null

  private activeOnCancel: (() => void) | null = null

  private remainingDistance = 0

  start(input: ScrollMotionStart): void {
    this.cancel('command-supersede')

    const {
      container,
      targetTop,
      maxDistancePx,
      minDurationMs,
      maxDurationMs,
      now,
      requestFrame,
      cancelFrame,
      onFrameWrite,
      onSettle,
      onCancel,
      source,
    } = input

    const startTop = container.scrollTop
    const totalDistance = targetTop - startTop

    if (Math.abs(totalDistance) <= TARGET_EPSILON_PX) {
      onSettle()
      return
    }

    const id = ++motionIdCounter
    let animateStartTop: number

    if (Math.abs(totalDistance) > maxDistancePx) {
      const sign = totalDistance > 0 ? 1 : -1
      const prePositionTarget = targetTop - sign * maxDistancePx
      onFrameWrite(prePositionTarget, source)
      animateStartTop = prePositionTarget
      this.remainingDistance = targetTop - prePositionTarget
    } else {
      animateStartTop = startTop
      this.remainingDistance = totalDistance
    }

    const ratio = Math.min(1, Math.abs(this.remainingDistance) / maxDistancePx)
    const durationMs = minDurationMs + ratio * (maxDurationMs - minDurationMs)
    const startTime = now()

    this.activeCancelFrame = cancelFrame
    this.activeOnSettle = onSettle
    this.activeOnCancel = onCancel

    this.active = {
      id,
      source,
      frameId: null,
    }

    const animate = (): void => {
      if (!this.active || this.active.id !== id) {
        return
      }

      const elapsed = now() - startTime
      const progress = Math.min(1, elapsed / durationMs)
      const easedProgress = easeOutQuint(progress)
      const currentTop = animateStartTop + this.remainingDistance * easedProgress

      onFrameWrite(currentTop, source)

      if (progress >= 1) {
        this.clearActive()
        onSettle()
        return
      }

      this.active.frameId = requestFrame(animate)
    }

    this.active.frameId = requestFrame(animate)
  }

  cancel(reason: ScrollMotionCancelReason): void {
    if (!this.active) {
      return
    }

    const { frameId } = this.active

    if (frameId !== null && this.activeCancelFrame) {
      this.activeCancelFrame(frameId)
    }

    const onCancel = this.activeOnCancel
    this.clearActive()
    void reason
    onCancel?.()
  }

  isActive(): boolean {
    return this.active !== null
  }

  adjustTarget(delta: number): void {
    if (!this.active) {
      return
    }

    this.remainingDistance += delta
  }

  private clearActive(): void {
    this.active = null
    this.activeCancelFrame = null
    this.activeOnSettle = null
    this.activeOnCancel = null
    this.remainingDistance = 0
  }
}
