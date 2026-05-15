import { describe, expect, it } from 'vitest'
import { ScrollMotionEngine } from '../scrollMotionEngine'
import { createContainer, FakeScheduler } from '../../test/fakes'
import type { ScrollSource } from '../types'

function startMotion(input: {
  container: HTMLElement
  scheduler: FakeScheduler
  targetTop: number
  source?: Extract<ScrollSource, 'programmatic' | 'followBottom' | 'jump'>
  maxDistancePx?: number
}) {
  const engine = new ScrollMotionEngine()
  const writes: Array<{ top: number; source: ScrollSource }> = []
  let settled = 0
  let cancelled = 0

  engine.start({
    container: input.container,
    source: input.source ?? 'jump',
    targetTop: input.targetTop,
    maxDistancePx: input.maxDistancePx ?? 800,
    minDurationMs: 180,
    maxDurationMs: 420,
    targetEpsilonPx: 1,
    now: () => input.scheduler.now(),
    requestFrame: (callback) => input.scheduler.requestAnimationFrame(callback),
    cancelFrame: (handle) => input.scheduler.cancelAnimationFrame(handle),
    onFrameWrite: (nextTop, source) => {
      input.container.scrollTop = nextTop
      writes.push({ top: nextTop, source })
    },
    onSettle: () => {
      settled += 1
    },
    onCancel: () => {
      cancelled += 1
    },
  })

  return {
    engine,
    writes,
    get settled() {
      return settled
    },
    get cancelled() {
      return cancelled
    },
  }
}

describe('ScrollMotionEngine', () => {
  it('pre-positions far targets with the original motion source', () => {
    const scheduler = new FakeScheduler()
    const container = createContainer({ height: 300 })

    container.scrollTop = 0
    const motion = startMotion({
      container,
      scheduler,
      targetTop: 2000,
      source: 'jump',
      maxDistancePx: 800,
    })

    expect(motion.writes[0]).toEqual({ top: 1200, source: 'jump' })

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(2000)
    expect(motion.settled).toBe(1)
    expect(motion.cancelled).toBe(0)
  })

  it('cancels active motion without settling', () => {
    const scheduler = new FakeScheduler()
    const container = createContainer({ height: 300 })
    const motion = startMotion({
      container,
      scheduler,
      targetTop: 600,
      source: 'followBottom',
    })

    motion.engine.cancel('user-interrupt')
    scheduler.flushFrames(5)

    expect(motion.cancelled).toBe(1)
    expect(motion.settled).toBe(0)
    expect(container.scrollTop).toBe(0)
  })

  it('settles immediately when already at the target', () => {
    const scheduler = new FakeScheduler()
    const container = createContainer({ height: 300 })

    container.scrollTop = 100
    const motion = startMotion({
      container,
      scheduler,
      targetTop: 100.5,
      source: 'programmatic',
    })

    expect(motion.writes).toEqual([])
    expect(motion.settled).toBe(1)
    expect(motion.engine.isActive()).toBe(false)
  })
})
