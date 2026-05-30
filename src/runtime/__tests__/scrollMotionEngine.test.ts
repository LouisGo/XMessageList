import { describe, expect, it } from 'vitest'
import { FakeScheduler, createContainer } from '../../test/fakes'
import { ScrollMotionEngine, type ScrollMotionCancelReason } from '../motion/scrollMotionEngine'

describe('ScrollMotionEngine', () => {
  it('prepositions far targets and preserves the motion source on writes', () => {
    const scheduler = new FakeScheduler()
    const engine = new ScrollMotionEngine()
    const container = createContainer({ height: 100 })
    const writes: Array<{ scrollTop: number; source: string }> = []
    let settled = false

    engine.start({
      container,
      source: 'jump',
      targetTop: 2_000,
      maxDistancePx: 500,
      minDurationMs: 100,
      maxDurationMs: 200,
      targetEpsilonPx: 1,
      now: () => scheduler.now(),
      requestFrame: (callback) => scheduler.requestAnimationFrame(callback),
      cancelFrame: (handle) => scheduler.cancelAnimationFrame(handle),
      onFrameWrite: (scrollTop, source) => {
        container.scrollTop = scrollTop
        writes.push({ scrollTop, source })
      },
      onSettle: () => { settled = true },
      onCancel: () => {},
    })

    expect(writes[0]).toEqual({ scrollTop: 1_500, source: 'jump' })
    expect(engine.isActive()).toBe(true)

    scheduler.flushFrames(20)

    expect(settled).toBe(true)
    expect(engine.isActive()).toBe(false)
    expect(writes.at(-1)).toEqual({ scrollTop: 2_000, source: 'jump' })
  })

  it('cancels an active motion without settling or writing later frames', () => {
    const scheduler = new FakeScheduler()
    const engine = new ScrollMotionEngine()
    const container = createContainer({ height: 100 })
    const writes: number[] = []
    let settled = false
    let cancelReason: ScrollMotionCancelReason | null = null

    engine.start({
      container,
      source: 'followBottom',
      targetTop: 300,
      maxDistancePx: 500,
      minDurationMs: 100,
      maxDurationMs: 200,
      targetEpsilonPx: 1,
      now: () => scheduler.now(),
      requestFrame: (callback) => scheduler.requestAnimationFrame(callback),
      cancelFrame: (handle) => scheduler.cancelAnimationFrame(handle),
      onFrameWrite: (scrollTop) => { writes.push(scrollTop) },
      onSettle: () => { settled = true },
      onCancel: (reason) => { cancelReason = reason },
    })

    engine.cancel('user-interrupt')
    scheduler.flushFrames(5)

    expect(cancelReason).toBe('user-interrupt')
    expect(settled).toBe(false)
    expect(writes).toHaveLength(0)
    expect(engine.isActive()).toBe(false)
  })
})
