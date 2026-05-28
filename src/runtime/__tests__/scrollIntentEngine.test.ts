import { describe, expect, it } from 'vitest'
import { ScrollIntentEngine } from '../scrollIntentEngine'

describe('ScrollIntentEngine', () => {
  it('keeps manual bottom intent when a runtime write token covers the scroll frame', () => {
    const engine = new ScrollIntentEngine(8, 64)

    engine.markUserIntent(10)
    engine.markScrollWrite('recovery', 10)

    const source = engine.classifyScroll(10)

    expect(source).toBe('recovery')
    expect(engine.updateBottomLockFromDistance(0, 10, source)).toBe(true)
    expect(engine.getBottomLockState()).toBe('LOCKED')
  })

  it('does not lock from a runtime write without active user intent', () => {
    const engine = new ScrollIntentEngine(8, 64)

    engine.markScrollWrite('recovery', 10)

    const source = engine.classifyScroll(10)

    expect(source).toBe('recovery')
    expect(engine.updateBottomLockFromDistance(0, 10, source)).toBe(false)
    expect(engine.getBottomLockState()).toBe('UNLOCKED')
  })
})
