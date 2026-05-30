import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type {
  MessageListRuntime,
  MessageListRuntimeEvent,
} from '../../runtime/index'
import type { MessageListDataRuntime } from '../../runtime/data/index'
import {
  createDemoRequestId,
  writeDemoLog,
} from '../data/demoLocalStoreClient'
import {
  applyAroundRequest,
  applyEdgeRequest,
  applyLatestRequest,
  type DemoRequestResult,
} from '../data/demoScenarioRequests'
import type { DemoMessage } from '../data/demoData'
import type { DemoFeedRuntimeCache } from '../runtime/useDemoFeedRuntimeCache'
import { EDGE_LOAD_DELAY_BASE_MS, PAGE_SIZE } from './demoScenarioConfig'
import {
  consumeDeferredEdgeResponseDelay,
  isRuntimeNeedEvent,
  waitMockDelay,
} from './demoScenarioHelpers'

type DemoRuntimeEventBridgeOptions = {
  runtimeCache: DemoFeedRuntimeCache
  getDataRuntime: (feedId: string) => MessageListDataRuntime<DemoMessage>
  publishSegment: (dataRuntime: MessageListDataRuntime<DemoMessage>) => void
  selectedFeedIdRef: MutableRefObject<string>
  feedLoadingRef: MutableRefObject<boolean>
  deferredEdgeResponseDelayMsRef: MutableRefObject<number>
  setEdgeLoading: (edge: 'before' | 'after', loading: boolean) => void
  setMessageCount: (messageCount: number) => void
  setLastEvent: (eventText: string) => void
}

/**
 * 把 runtime semantic need events 接到 demo API 和 data runtime；这里不读取 DOM，也不直接修正滚动。
 */
export function useDemoRuntimeEventBridge({
  runtimeCache,
  getDataRuntime,
  publishSegment,
  selectedFeedIdRef,
  feedLoadingRef,
  deferredEdgeResponseDelayMsRef,
  setEdgeLoading,
  setMessageCount,
  setLastEvent,
}: DemoRuntimeEventBridgeOptions) {
  const runtimeEventSubscriptionsRef = useRef(new Map<string, {
    runtime: MessageListRuntime<DemoMessage>
    unsubscribe: () => void
  }>())
  const handleSemanticEventRef = useRef<
    (event: MessageListRuntimeEvent) => Promise<DemoRequestResult | null> | null
  >(() => null)

  const handleSemanticEvent = useCallback((
    event: MessageListRuntimeEvent,
  ): Promise<DemoRequestResult | null> | null => {
    if (!isRuntimeNeedEvent(event)) {
      return null
    }

    const dataRuntime = getDataRuntime(event.feedId)
    const context = {
      dataRuntime,
      runtime: runtimeCache.getRuntime(event.feedId),
      publishSegment,
      pageSize: PAGE_SIZE,
    }

    if (event.type === 'needLatestMessages') {
      return waitMockDelay(EDGE_LOAD_DELAY_BASE_MS)
        .then(() => applyLatestRequest({ ...context, feedId: event.feedId, event }))
    }

    if (event.type === 'needMessagesAround') {
      return waitMockDelay(EDGE_LOAD_DELAY_BASE_MS)
        .then(() => applyAroundRequest({ ...context, event }))
    }

    if (event.type === 'needMoreBefore' || event.type === 'needMoreAfter') {
      const edge = event.type === 'needMoreBefore' ? 'before' : 'after'
      const isSelectedFeed = selectedFeedIdRef.current === event.feedId
      // underflow-fill 是 runtime 自动补齐，不展示成用户可见的 edge loading。
      const canExposeEdgeLoading = isSelectedFeed &&
        !feedLoadingRef.current &&
        event.reason !== 'underflow-fill'
      const delayMs = isSelectedFeed
        ? consumeDeferredEdgeResponseDelay(deferredEdgeResponseDelayMsRef)
        : 0

      if (canExposeEdgeLoading) {
        setEdgeLoading(edge, true)
      }

      return waitMockDelay(delayMs > 0 ? delayMs : EDGE_LOAD_DELAY_BASE_MS)
        .then(() => applyEdgeRequest({ ...context, event }))
        .finally(() => {
          if (canExposeEdgeLoading && selectedFeedIdRef.current === event.feedId) {
            setEdgeLoading(edge, false)
          }
        })
    }

    return null
  }, [
    deferredEdgeResponseDelayMsRef,
    feedLoadingRef,
    getDataRuntime,
    publishSegment,
    runtimeCache,
    selectedFeedIdRef,
    setEdgeLoading,
  ])

  useEffect(() => {
    handleSemanticEventRef.current = handleSemanticEvent
  }, [handleSemanticEvent])

  const ensureRuntimeEventSubscription = useCallback((feedId: string) => {
    const runtimeForFeed = runtimeCache.getRuntime(feedId)
    const existing = runtimeEventSubscriptionsRef.current.get(feedId)

    if (existing?.runtime === runtimeForFeed) {
      return
    }

    existing?.unsubscribe()
    const unsubscribe = runtimeForFeed.subscribeRuntimeEvent((event) => {
      const eventFeedId = 'feedId' in event
        ? event.feedId
        : runtimeForFeed.getSnapshot().feedId
      void writeDemoLog({
        requestId: createDemoRequestId('runtime.event'),
        operation: 'runtime.event',
        phase: 'info',
        feedId: eventFeedId,
        messageCount: getDataRuntime(eventFeedId).getSegment().items.length,
        details: event as unknown as Record<string, unknown>,
      })
      const request = handleSemanticEventRef.current(event)
      if (!request) {
        return
      }
      void request.then((result) => {
        if (result && selectedFeedIdRef.current === eventFeedId) {
          if (typeof result.total === 'number') {
            setMessageCount(result.total)
          }
          setLastEvent(result.message)
        }
      }).catch((error: unknown) => {
        if (event.type === 'needMoreBefore' || event.type === 'needMoreAfter') {
          runtimeForFeed.reportEdgeRequestFailure(event.edge, event.requestToken)
          if (selectedFeedIdRef.current === eventFeedId) {
            setEdgeLoading(event.edge, false)
          }
        }
        void writeDemoLog({
          requestId: createDemoRequestId('runtime.event'),
          operation: 'runtime.event',
          phase: 'error',
          feedId: eventFeedId,
          messageCount: getDataRuntime(eventFeedId).getSegment().items.length,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    })

    runtimeEventSubscriptionsRef.current.set(feedId, {
      runtime: runtimeForFeed,
      unsubscribe,
    })
  }, [
    getDataRuntime,
    runtimeCache,
    selectedFeedIdRef,
    setEdgeLoading,
    setLastEvent,
    setMessageCount,
  ])

  useEffect(() => {
    const subscriptions = runtimeEventSubscriptionsRef.current
    return () => {
      for (const subscription of subscriptions.values()) {
        subscription.unsubscribe()
      }
      subscriptions.clear()
    }
  }, [])

  return ensureRuntimeEventSubscription
}
