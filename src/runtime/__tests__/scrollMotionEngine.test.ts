import { describe, expect, it, vi } from 'vitest'
import { ScrollMotionEngine } from '../scrollMotionEngine'

function createMotionInput(overrides: Record<string, unknown> = {}) {
  const container = {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 400,
  } as unknown as HTMLElement

  const frameCallbacks: Array<FrameRequestCallback> = []
  const handleMap = new Map<number, FrameRequestCallback>()
  let nextHandle = 1

  return {
    container,
    frameCallbacks,
    handleMap,
    input: {
      container,
      source: 'programmatic' as const,
      targetTop: 500,
      maxDistancePx: 800,
      minDurationMs: 180,
      maxDurationMs: 420,
      now: () => 0,
      requestFrame: (cb: FrameRequestCallback) => {
        const handle = nextHandle++
        handleMap.set(handle, cb)
        return handle
      },
      cancelFrame: (handle: number) => {
        handleMap.delete(handle)
      },
      onFrameWrite: vi.fn(),
      onSettle: vi.fn(),
      onCancel: vi.fn(),
      ...overrides,
    },
  }
}

describe('ScrollMotionEngine', () => {
  it('settles immediately when distance is within epsilon', () => {
    const engine = new ScrollMotionEngine()
    const { input } = createMotionInput({
      targetTop: 0.5,
      container: { scrollTop: 0 } as unknown as HTMLElement,
    })

    engine.start(input)
    expect(input.onSettle).toHaveBeenCalledOnce()
    expect(input.onFrameWrite).not.toHaveBeenCalled()
    expect(engine.isActive()).toBe(false)
  })

  it('pre-positions synchronously then animates for far distances', () => {
    const engine = new ScrollMotionEngine()
    let currentTime = 0
    const frameCallbacks: Array<FrameRequestCallback> = []
    const handleMap = new Map<number, FrameRequestCallback>()
    let nextHandle = 1
    let scrollTop = 0

    const onFrameWrite = vi.fn((nextTop: number) => {
      scrollTop = nextTop
    })

    engine.start({
      container: { scrollTop: 0 } as unknown as HTMLElement,
      source: 'followBottom',
      targetTop: 2000,
      maxDistancePx: 800,
      minDurationMs: 180,
      maxDurationMs: 420,
      now: () => currentTime,
      requestFrame: (cb: FrameRequestCallback) => {
        const handle = nextHandle++
        handleMap.set(handle, cb)
        frameCallbacks.push(cb)
        return handle
      },
      cancelFrame: (handle: number) => {
        handleMap.delete(handle)
        const index = frameCallbacks.indexOf(handleMap.get(handle) as FrameRequestCallback)
        if (index >= 0) frameCallbacks.splice(index, 1)
      },
      onFrameWrite,
      onSettle: vi.fn(),
      onCancel: vi.fn(),
    })

    // After start, should have pre-positioned to target - maxDistancePx
    expect(onFrameWrite).toHaveBeenCalledTimes(1)
    expect(scrollTop).toBe(1200) // 2000 - 800
    expect(engine.isActive()).toBe(true)
    expect(onFrameWrite.mock.calls[0][1]).toBe('followBottom')
  })

  it('animates over the remaining distance within maxDurationMs', () => {
    const engine = new ScrollMotionEngine()
    let currentTime = 0
    const frameCallbacks: Array<FrameRequestCallback> = []
    let scrollTop = 1000 // start near bottom
    const onFrameWrite = vi.fn((nextTop: number) => {
      scrollTop = nextTop
    })
    const onSettle = vi.fn()

    engine.start({
      container: { scrollTop: 1000 } as unknown as HTMLElement,
      source: 'jump',
      targetTop: 500,
      maxDistancePx: 800,
      minDurationMs: 180,
      maxDurationMs: 420,
      now: () => currentTime,
      requestFrame: (cb: FrameRequestCallback) => {
        frameCallbacks.push(cb)
        return frameCallbacks.length
      },
      cancelFrame: () => {},
      onFrameWrite,
      onSettle,
      onCancel: vi.fn(),
    })

    expect(engine.isActive()).toBe(true)
    // First onFrameWrite call happens inside the rAF callback
    expect(onFrameWrite).not.toHaveBeenCalled()

    // Simulate animation frames
    while (frameCallbacks.length > 0) {
      currentTime += 16
      const cb = frameCallbacks.shift()!
      cb(currentTime)
    }

    // After all frames, should have reached target
    expect(scrollTop).toBe(500)
    expect(onSettle).toHaveBeenCalledOnce()
    expect(engine.isActive()).toBe(false)
  })

  it('cancel makes subsequent rAF callbacks no-op', () => {
    const engine = new ScrollMotionEngine()
    let currentTime = 0
    const frameCallbacks: Array<FrameRequestCallback> = []
    const onFrameWrite = vi.fn()
    const onSettle = vi.fn()
    const onCancel = vi.fn()

    engine.start({
      container: { scrollTop: 0 } as unknown as HTMLElement,
      source: 'programmatic',
      targetTop: 500,
      maxDistancePx: 800,
      minDurationMs: 180,
      maxDurationMs: 420,
      now: () => currentTime,
      requestFrame: (cb: FrameRequestCallback) => {
        frameCallbacks.push(cb)
        return frameCallbacks.length
      },
      cancelFrame: () => {},
      onFrameWrite,
      onSettle,
      onCancel,
    })

    const writeCountBeforeCancel = onFrameWrite.mock.calls.length

    engine.cancel('user-scroll')

    expect(onCancel).toHaveBeenCalledOnce()
    expect(engine.isActive()).toBe(false)

    // Run remaining queued frames — they should be no-ops
    while (frameCallbacks.length > 0) {
      currentTime += 16
      const cb = frameCallbacks.shift()!
      cb(currentTime)
    }

    // No new writes after cancel
    expect(onFrameWrite.mock.calls.length).toBe(writeCountBeforeCancel)
    // onSettle should NOT be called after cancel
    expect(onSettle).not.toHaveBeenCalled()
  })

  it('adjustTarget shifts the remaining animation distance', () => {
    const engine = new ScrollMotionEngine()
    let currentTime = 0
    const frameCallbacks: Array<FrameRequestCallback> = []
    let scrollTop = 0
    const onFrameWrite = vi.fn((nextTop: number) => {
      scrollTop = nextTop
    })
    const onSettle = vi.fn()

    engine.start({
      container: { scrollTop: 0 } as unknown as HTMLElement,
      source: 'followBottom',
      targetTop: 400,
      maxDistancePx: 800,
      minDurationMs: 180,
      maxDurationMs: 420,
      now: () => currentTime,
      requestFrame: (cb: FrameRequestCallback) => {
        frameCallbacks.push(cb)
        return frameCallbacks.length
      },
      cancelFrame: () => {},
      onFrameWrite,
      onSettle,
      onCancel: vi.fn(),
    })

    // Adjust target by +100 (bottom grew by 100px)
    engine.adjustTarget(100)

    // Run animation to completion
    while (frameCallbacks.length > 0) {
      currentTime += 16
      const cb = frameCallbacks.shift()!
      cb(currentTime)
    }

    expect(scrollTop).toBe(500) // original 400 + 100 adjusted
    expect(onSettle).toHaveBeenCalledOnce()
  })

  it('uses the semantic source token in every onFrameWrite call', () => {
    const engine = new ScrollMotionEngine()
    let currentTime = 0
    const frameCallbacks: Array<FrameRequestCallback> = []
    const onFrameWrite = vi.fn()

    engine.start({
      container: { scrollTop: 0 } as unknown as HTMLElement,
      source: 'jump',
      targetTop: 300,
      maxDistancePx: 800,
      minDurationMs: 180,
      maxDurationMs: 420,
      now: () => currentTime,
      requestFrame: (cb: FrameRequestCallback) => {
        frameCallbacks.push(cb)
        return frameCallbacks.length
      },
      cancelFrame: () => {},
      onFrameWrite,
      onSettle: vi.fn(),
      onCancel: vi.fn(),
    })

    // Check every call uses 'jump' source
    for (const call of onFrameWrite.mock.calls) {
      expect(call[1]).toBe('jump')
    }
  })

  it('supersedes existing motion when start is called again', () => {
    const engine = new ScrollMotionEngine()
    const onCancel1 = vi.fn()
    const onSettle1 = vi.fn()
    const { input: input1 } = createMotionInput({
      targetTop: 300,
      onCancel: onCancel1,
      onSettle: onSettle1,
    })

    engine.start(input1)
    expect(engine.isActive()).toBe(true)

    // Start a new motion
    const onFrameWrite2 = vi.fn()
    engine.start({
      ...input1,
      targetTop: 600,
      onFrameWrite: onFrameWrite2,
      onSettle: vi.fn(),
      onCancel: vi.fn(),
    })

    // Old motion should be cancelled
    expect(onCancel1).toHaveBeenCalledOnce()
    // Old motion should NOT settle
    expect(onSettle1).not.toHaveBeenCalled()
    // New motion should be active
    expect(engine.isActive()).toBe(true)
  })
})
