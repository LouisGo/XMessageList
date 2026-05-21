import { describe, expect, it, vi } from 'vitest'

import type { MessageViewportRuntime } from '../../runtime.deprecated'
import type { DemoMessage } from '../demoData'
import { createDemoFeedRuntimeCache } from '../useDemoFeedRuntimeCache'

type RuntimeDouble = MessageViewportRuntime<DemoMessage> & {
  feedId: string
  destroy: ReturnType<typeof vi.fn>
}

function createRuntimeDouble(feedId: string): RuntimeDouble {
  return {
    feedId,
    destroy: vi.fn(),
  } as unknown as RuntimeDouble
}

describe('createDemoFeedRuntimeCache', () => {
  it('reuses feed-scoped runtimes and evicts the least recently used runtime', () => {
    const created = new Map<string, RuntimeDouble>()
    const cache = createDemoFeedRuntimeCache({
      capacity: 3,
      createRuntime: (feedId) => {
        const runtime = createRuntimeDouble(feedId)
        created.set(feedId, runtime)
        return runtime
      },
    })

    const runtimeA = cache.getRuntime('feed-a')
    const runtimeB = cache.getRuntime('feed-b')
    const runtimeC = cache.getRuntime('feed-c')

    expect(cache.getRuntime('feed-a')).toBe(runtimeA)
    expect(cache.getCachedFeedIds()).toEqual(['feed-a', 'feed-c', 'feed-b'])

    const runtimeD = cache.getRuntime('feed-d')

    expect(runtimeD).toBe(created.get('feed-d'))
    expect(runtimeB.destroy).toHaveBeenCalledTimes(1)
    expect(runtimeA.destroy).not.toHaveBeenCalled()
    expect(runtimeC.destroy).not.toHaveBeenCalled()
    expect(cache.hasRuntime('feed-a')).toBe(true)
    expect(cache.hasRuntime('feed-b')).toBe(false)
    expect(cache.getCachedFeedIds()).toEqual(['feed-d', 'feed-a', 'feed-c'])
  })

  it('can delete one cached runtime without touching the rest', () => {
    const cache = createDemoFeedRuntimeCache({
      capacity: 3,
      createRuntime: createRuntimeDouble,
    })
    const runtimeA = cache.getRuntime('feed-a') as RuntimeDouble
    const runtimeB = cache.getRuntime('feed-b') as RuntimeDouble

    expect(cache.deleteRuntime('feed-a')).toBe(true)
    expect(cache.deleteRuntime('missing')).toBe(false)

    expect(runtimeA.destroy).toHaveBeenCalledTimes(1)
    expect(runtimeB.destroy).not.toHaveBeenCalled()
    expect(cache.hasRuntime('feed-a')).toBe(false)
    expect(cache.hasRuntime('feed-b')).toBe(true)
    expect(cache.getCachedFeedIds()).toEqual(['feed-b'])
  })

  it('destroys every cached runtime when cleared by the host lifecycle', () => {
    const cache = createDemoFeedRuntimeCache({
      capacity: 3,
      createRuntime: createRuntimeDouble,
    })
    const runtimeA = cache.getRuntime('feed-a') as RuntimeDouble
    const runtimeB = cache.getRuntime('feed-b') as RuntimeDouble

    cache.destroyAll()

    expect(runtimeA.destroy).toHaveBeenCalledTimes(1)
    expect(runtimeB.destroy).toHaveBeenCalledTimes(1)
    expect(cache.getCachedFeedIds()).toEqual([])
  })
})
