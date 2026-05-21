import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageViewportRuntime } from '../runtime-next'
import type { DemoMessage } from './demoData'
import { LRUCache } from './utils/lru'

export const DEMO_FEED_RUNTIME_CACHE_CAPACITY = 3

type DemoRuntimeFactory = (
  feedId: string,
  generation: number,
) => MessageViewportRuntime<DemoMessage>

export type DemoFeedRuntimeCache = {
  getRuntime: (
    feedId: string,
    generation: number,
  ) => MessageViewportRuntime<DemoMessage>
  hasRuntime: (feedId: string, generation: number) => boolean
  deleteRuntime: (feedId: string, generation?: number) => boolean
  getCachedFeedIds: () => string[]
  destroyAll: () => void
}

function createDemoFeedRuntime(
  feedId: string,
  generation: number,
): MessageViewportRuntime<DemoMessage> {
  return new MessageViewportRuntime<DemoMessage>({
    feedId,
    generation,
  })
}

export function createDemoFeedRuntimeCache({
  capacity = DEMO_FEED_RUNTIME_CACHE_CAPACITY,
  createRuntime = createDemoFeedRuntime,
}: {
  capacity?: number
  createRuntime?: DemoRuntimeFactory
} = {}): DemoFeedRuntimeCache {
  const cache = new LRUCache<string, MessageViewportRuntime<DemoMessage>>(
    capacity,
    (_feedId, runtime) => {
      runtime.destroy()
    },
  )

  return {
    getRuntime(feedId, generation) {
      const key = createRuntimeCacheKey(feedId, generation)
      return cache.getOrSet(key, () => createRuntime(feedId, generation))
    },
    hasRuntime(feedId, generation) {
      return cache.has(createRuntimeCacheKey(feedId, generation))
    },
    deleteRuntime(feedId, generation) {
      const keys = generation === undefined
        ? cache.getLruKeys().filter((key) => getFeedIdFromRuntimeCacheKey(key) === feedId)
        : [createRuntimeCacheKey(feedId, generation)]
      let deleted = false

      keys.forEach((key) => {
        const runtime = cache.peek(key)

        if (!runtime) {
          return
        }

        runtime.destroy()
        deleted = cache.delete(key) || deleted
      })

      return deleted
    },
    getCachedFeedIds() {
      const feedIds: string[] = []

      cache.getLruKeys().forEach((key) => {
        const feedId = getFeedIdFromRuntimeCacheKey(key)

        if (!feedIds.includes(feedId)) {
          feedIds.push(feedId)
        }
      })

      return feedIds
    },
    destroyAll() {
      cache.forEach((runtime) => {
        runtime.destroy()
      })
      cache.clear()
    },
  }
}

export function useDemoFeedRuntimeCache(): DemoFeedRuntimeCache {
  const [cache] = useState(() => createDemoFeedRuntimeCache())
  const destroyTimerRef = useRef<number | null>(null)

  const destroyAll = useCallback(() => {
    cache.destroyAll()
  }, [cache])

  useEffect(() => {
    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current)
      destroyTimerRef.current = null
    }

    return () => {
      // React 18 StrictMode 会在开发环境模拟一次 effect cleanup/setup。
      // 真正销毁 runtime cache 延后一拍，避免把仍会复用的 feed runtime 置为 DESTROYED。
      destroyTimerRef.current = window.setTimeout(() => {
        destroyAll()
        destroyTimerRef.current = null
      }, 0)
    }
  }, [destroyAll])

  return useMemo(
    () => ({
      getRuntime: cache.getRuntime,
      hasRuntime: cache.hasRuntime,
      deleteRuntime: cache.deleteRuntime,
      getCachedFeedIds: cache.getCachedFeedIds,
      destroyAll,
    }),
    [cache, destroyAll],
  )
}

function createRuntimeCacheKey(feedId: string, generation: number): string {
  return `${feedId}::${generation}`
}

function getFeedIdFromRuntimeCacheKey(key: string): string {
  const separatorIndex = key.lastIndexOf('::')

  return separatorIndex >= 0 ? key.slice(0, separatorIndex) : key
}
