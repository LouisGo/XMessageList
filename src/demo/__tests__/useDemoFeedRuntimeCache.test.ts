import { describe, expect, it, vi } from 'vitest'

import type { MessageViewportRuntime } from '../../runtime-next'
import type { DemoMessage } from '../demoData'
import { createDemoFeedRuntimeCache } from '../useDemoFeedRuntimeCache'

type RuntimeDouble = MessageViewportRuntime<DemoMessage> & {
  feedId: string
  generation: number
  destroy: ReturnType<typeof vi.fn>
}

function createRuntimeDouble(feedId: string, generation: number): RuntimeDouble {
  return {
    feedId,
    generation,
    destroy: vi.fn(),
  } as unknown as RuntimeDouble
}

describe('createDemoFeedRuntimeCache', () => {
  it('reuses generation-scoped runtimes and evicts the least recently used runtime', () => {
    const created = new Map<string, RuntimeDouble>()
    const cache = createDemoFeedRuntimeCache({
      capacity: 3,
      createRuntime: (feedId, generation) => {
        const runtime = createRuntimeDouble(feedId, generation)
        created.set(`${feedId}:${generation}`, runtime)
        return runtime
      },
    })

    const runtimeA = cache.getRuntime('feed-a', 1)
    const runtimeB = cache.getRuntime('feed-b', 1)
    const runtimeC = cache.getRuntime('feed-c', 1)

    expect(cache.getRuntime('feed-a', 1)).toBe(runtimeA)
    expect(cache.getCachedFeedIds()).toEqual(['feed-a', 'feed-c', 'feed-b'])

    const runtimeD = cache.getRuntime('feed-d', 1)

    expect(runtimeD).toBe(created.get('feed-d:1'))
    expect(runtimeB.destroy).toHaveBeenCalledTimes(1)
    expect(runtimeA.destroy).not.toHaveBeenCalled()
    expect(runtimeC.destroy).not.toHaveBeenCalled()
    expect(cache.hasRuntime('feed-a', 1)).toBe(true)
    expect(cache.hasRuntime('feed-b', 1)).toBe(false)
    expect(cache.getCachedFeedIds()).toEqual(['feed-d', 'feed-a', 'feed-c'])
  })

  it('can delete one cached runtime without touching the rest', () => {
    const cache = createDemoFeedRuntimeCache({
      capacity: 3,
      createRuntime: createRuntimeDouble,
    })
    const runtimeA = cache.getRuntime('feed-a', 1) as RuntimeDouble
    const runtimeB = cache.getRuntime('feed-b', 1) as RuntimeDouble

    expect(cache.deleteRuntime('feed-a', 1)).toBe(true)
    expect(cache.deleteRuntime('missing')).toBe(false)

    expect(runtimeA.destroy).toHaveBeenCalledTimes(1)
    expect(runtimeB.destroy).not.toHaveBeenCalled()
    expect(cache.hasRuntime('feed-a', 1)).toBe(false)
    expect(cache.hasRuntime('feed-b', 1)).toBe(true)
    expect(cache.getCachedFeedIds()).toEqual(['feed-b'])
  })

  it('can delete all generations for one feed', () => {
    const cache = createDemoFeedRuntimeCache({
      capacity: 3,
      createRuntime: createRuntimeDouble,
    })
    const runtimeA1 = cache.getRuntime('feed-a', 1) as RuntimeDouble
    const runtimeA2 = cache.getRuntime('feed-a', 2) as RuntimeDouble
    const runtimeB = cache.getRuntime('feed-b', 1) as RuntimeDouble

    expect(cache.deleteRuntime('feed-a')).toBe(true)

    expect(runtimeA1.destroy).toHaveBeenCalledTimes(1)
    expect(runtimeA2.destroy).toHaveBeenCalledTimes(1)
    expect(runtimeB.destroy).not.toHaveBeenCalled()
    expect(cache.hasRuntime('feed-a', 1)).toBe(false)
    expect(cache.hasRuntime('feed-a', 2)).toBe(false)
    expect(cache.getCachedFeedIds()).toEqual(['feed-b'])
  })

  it('destroys every cached runtime when cleared by the host lifecycle', () => {
    const cache = createDemoFeedRuntimeCache({
      capacity: 3,
      createRuntime: createRuntimeDouble,
    })
    const runtimeA = cache.getRuntime('feed-a', 1) as RuntimeDouble
    const runtimeB = cache.getRuntime('feed-b', 1) as RuntimeDouble

    cache.destroyAll()

    expect(runtimeA.destroy).toHaveBeenCalledTimes(1)
    expect(runtimeB.destroy).toHaveBeenCalledTimes(1)
    expect(cache.getCachedFeedIds()).toEqual([])
  })
})
