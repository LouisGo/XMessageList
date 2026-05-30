import { useEffect, useMemo, useState } from 'react'
import {
  createMessageListRuntime,
  type MessageListRuntime,
} from '../../runtime/index'
import type { DemoMessage } from '../data/demoData'
import { LRUCache } from '../utils/lru'

export const DEMO_FEED_RUNTIME_CACHE_CAPACITY = 3

export type DemoRuntimeFactory = (
  feedId: string,
) => MessageListRuntime<DemoMessage>

export type DemoFeedRuntimeCache = {
  getRuntime: (feedId: string) => MessageListRuntime<DemoMessage>
  hasRuntime: (feedId: string) => boolean
  deleteRuntime: (feedId: string) => boolean
  getCachedFeedIds: () => string[]
  destroyAll: () => void
}

export type DemoFeedRuntimeCacheOptions = {
  capacity?: number
  createRuntime?: DemoRuntimeFactory
}

export function createDemoFeedRuntime(
  feedId: string,
): MessageListRuntime<DemoMessage> {
  return createMessageListRuntime<DemoMessage>({ feedId })
}

export function createDemoFeedRuntimeCache({
  capacity = DEMO_FEED_RUNTIME_CACHE_CAPACITY,
  createRuntime = createDemoFeedRuntime,
}: DemoFeedRuntimeCacheOptions = {}): DemoFeedRuntimeCache {
  const cache = new LRUCache<string, MessageListRuntime<DemoMessage>>(
    capacity,
    (_feedId, runtime) => runtime.destroy(),
  )

  return {
    getRuntime: (feedId) => cache.getOrSet(feedId, () => createRuntime(feedId)),
    hasRuntime: (feedId) => cache.has(feedId),
    deleteRuntime(feedId) {
      const runtime = cache.peek(feedId)
      runtime?.destroy()
      return cache.delete(feedId)
    },
    getCachedFeedIds: () => cache.getLruKeys(),
    destroyAll() {
      cache.forEach((runtime) => runtime.destroy())
      cache.clear()
    },
  }
}

export function useDemoFeedRuntimeCache(
  options: DemoFeedRuntimeCacheOptions = {},
): DemoFeedRuntimeCache {
  const [cache] = useState(() => createDemoFeedRuntimeCache(options))

  useEffect(() => () => cache.destroyAll(), [cache])

  return useMemo(() => cache, [cache])
}
