import { useEffect } from 'react'
import type { MessageListDataRuntime } from '../../runtime/data'
import type { DemoMessage } from '../demoData'
import {
  loadDemoFeedMessages,
  loadDemoViewportAnchor,
} from '../demoMessageApi'
import {
  applyLatestRequest,
  toRuntimeAnchor,
} from '../demoScenarioRequests'
import type { DemoFeedRuntimeCache } from '../useDemoFeedRuntimeCache'
import { getDemoFeedDefinition } from '../demoFeeds'
import {
  wait,
} from './demoScenarioHelpers'
import {
  restoreAroundAnchor,
  type SavedRuntimeAnchor,
} from './demoScenarioRuntimeHelpers'

export function useDemoFeedBootstrap(input: {
  activeFeedId: string
  pendingFeedId: string | null
  pageSize: number
  runtimeCache: DemoFeedRuntimeCache
  getDataRuntime: (feedId: string) => MessageListDataRuntime<DemoMessage>
  publishSegment: (dataRuntime: MessageListDataRuntime<DemoMessage>) => void
  bootstrapTokenRef: { current: number }
  deferredSessionResponseDelayMsRef: { current: number }
  savedAnchorsRef: { current: Map<string, SavedRuntimeAnchor> }
  activeFeedIdRef: { current: string }
  setActiveFeedId: (feedId: string) => void
  setPendingFeedId: (feedId: string | null) => void
  setMessages: (messages: DemoMessage[]) => void
  setMessageCount: (messageCount: number) => void
  setFeedLoading: (loading: boolean) => void
  setLastEvent: (eventText: string) => void
}): void {
  const {
    activeFeedId,
    activeFeedIdRef,
    bootstrapTokenRef,
    deferredSessionResponseDelayMsRef,
    getDataRuntime,
    pageSize,
    pendingFeedId,
    publishSegment,
    runtimeCache,
    savedAnchorsRef,
    setActiveFeedId,
    setFeedLoading,
    setLastEvent,
    setMessageCount,
    setMessages,
    setPendingFeedId,
  } = input

  useEffect(() => {
    let cancelled = false
    const bootstrapToken = bootstrapTokenRef.current + 1
    bootstrapTokenRef.current = bootstrapToken
    const feedId = pendingFeedId ?? activeFeedId
    const feed = getDemoFeedDefinition(feedId)
    const runtimeForFeed = runtimeCache.getRuntime(feedId)
    const dataRuntime = getDataRuntime(feedId)
    const cachedSegment = dataRuntime.getSegment()
    const completeActivation = (activation: {
      messages?: DemoMessage[]
      messageCount?: number
      savedAnchor?: SavedRuntimeAnchor
    } = {}) => {
      if (pendingFeedId === feedId) {
        activeFeedIdRef.current = feedId
        setActiveFeedId(feedId)
        setPendingFeedId(null)
      }
      if (activation.messages) setMessages(activation.messages)
      if (typeof activation.messageCount === 'number') {
        setMessageCount(activation.messageCount)
      }
      if (activation.savedAnchor) {
        savedAnchorsRef.current.set(feedId, activation.savedAnchor)
      }
    }

    void (async () => {
      if (cancelled || bootstrapToken !== bootstrapTokenRef.current) return
      if (cachedSegment.items.length > 0) {
        const savedAnchor = savedAnchorsRef.current.get(feedId)
        const allMessages = await loadDemoFeedMessages(feedId)
        if (cancelled || bootstrapToken !== bootstrapTokenRef.current) return
        completeActivation({
          messages: cachedSegment.items
            .map((item) => item.message)
            .filter((message): message is DemoMessage => Boolean(message)),
          messageCount: allMessages.length,
        })
        setLastEvent(savedAnchor ? `restored ${feed.title}` : `loaded ${feed.title}`)
        if (runtimeForFeed.getSnapshot().segmentRevision !== cachedSegment.segmentRevision) {
          publishSegment(dataRuntime)
        }
        setFeedLoading(false)
        return
      }

      const sessionDelayMs = deferredSessionResponseDelayMsRef.current
      deferredSessionResponseDelayMsRef.current = 0
      if (sessionDelayMs > 0) {
        await wait(sessionDelayMs)
        if (cancelled || bootstrapToken !== bootstrapTokenRef.current) return
      }
      const persistedAnchor = await loadDemoViewportAnchor(feedId)
      const persistedRuntimeAnchor = persistedAnchor
        ? toRuntimeAnchor(feedId, persistedAnchor.messageId)
        : undefined
      if (persistedRuntimeAnchor) {
        const restored = await restoreAroundAnchor({
          dataRuntime,
          runtime: runtimeForFeed,
          publishSegment,
          feedId,
          pageSize,
          target: persistedRuntimeAnchor,
          align: 'start',
          offsetWithinMessage: persistedAnchor.offsetWithinMessage,
        })
        if (cancelled || bootstrapToken !== bootstrapTokenRef.current) return
        if (restored.status === 'applied') {
          completeActivation({
            messages: dataRuntime.getSegment().items
              .map((item) => item.message)
              .filter((message): message is DemoMessage => Boolean(message)),
            messageCount: restored.total,
            savedAnchor: {
              anchor: persistedRuntimeAnchor,
              offsetWithinMessage: persistedAnchor.offsetWithinMessage,
            },
          })
          setLastEvent(`restored ${feed.title}`)
          setFeedLoading(false)
          return
        }
      }

      const result = await applyLatestRequest({
        dataRuntime,
        feedId,
        runtime: runtimeForFeed,
        publishSegment,
        pageSize,
        isStale: () => cancelled || bootstrapToken !== bootstrapTokenRef.current,
      })
      if (!cancelled && bootstrapToken === bootstrapTokenRef.current) {
        completeActivation({
          messages: dataRuntime.getSegment().items
            .map((item) => item.message)
            .filter((message): message is DemoMessage => Boolean(message)),
          messageCount: result.total,
        })
        setLastEvent(result.message)
        setFeedLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    activeFeedId,
    activeFeedIdRef,
    bootstrapTokenRef,
    deferredSessionResponseDelayMsRef,
    getDataRuntime,
    pageSize,
    pendingFeedId,
    publishSegment,
    runtimeCache,
    savedAnchorsRef,
    setActiveFeedId,
    setFeedLoading,
    setLastEvent,
    setMessageCount,
    setMessages,
    setPendingFeedId,
  ])
}
