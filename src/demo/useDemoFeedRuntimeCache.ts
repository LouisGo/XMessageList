import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageViewportRuntime } from '../runtime'
import type { DemoMessage } from './demoData'
import { LRUCache } from './utils/lru'

export const DEMO_FEED_RUNTIME_CACHE_CAPACITY = 3

const DEMO_RUNTIME_WINDOW = {
  minMountedItems: 60,
  maxMountedItems: 180,
  defaultItemHeight: 104,
}

type DemoRuntimeFactory = (
  feedId: string,
) => MessageViewportRuntime<DemoMessage>

export type DemoFeedRuntimeCache = {
  getRuntime: (feedId: string) => MessageViewportRuntime<DemoMessage>
  hasRuntime: (feedId: string) => boolean
  deleteRuntime: (feedId: string) => boolean
  getCachedFeedIds: () => string[]
  destroyAll: () => void
}

function createDemoFeedRuntime(feedId: string): MessageViewportRuntime<DemoMessage> {
  return new MessageViewportRuntime<DemoMessage>({
    feedId,
    generation: 1,
    window: DEMO_RUNTIME_WINDOW,
    bottomUnlockThresholdPx: 200,
    edgeLoadThresholdPx: 72,
    debug: { diagnostics: true },
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
    getRuntime(feedId) {
      return cache.getOrSet(feedId, () => createRuntime(feedId))
    },
    hasRuntime(feedId) {
      return cache.has(feedId)
    },
    deleteRuntime(feedId) {
      const runtime = cache.peek(feedId)

      if (!runtime) {
        return false
      }

      runtime.destroy()
      return cache.delete(feedId)
    },
    getCachedFeedIds() {
      return cache.getLruKeys()
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
