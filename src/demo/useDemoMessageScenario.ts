import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MessageIdentityAnchor,
  MessageListRuntime,
  MessageListRuntimeEvent,
  ViewportAnchorChangedEvent,
} from '../runtime'
import {
  createMessageListDataRuntime,
  type MessageListDataRuntime,
} from '../runtime/data'
import {
  createNewestMessage,
  toDemoMessageDataItem,
  type DemoMessage,
} from './demoData'
import { DEMO_FEEDS, getDemoFeedDefinition } from './demoFeeds'
import {
  replaceDemoFeedMessages,
} from './demoMessageApi'
import {
  applyAroundRequest,
  applyEdgeRequest,
  applyLatestRequest,
} from './demoScenarioRequests'
import type { DemoFeedRuntimeCache } from './useDemoFeedRuntimeCache'

const PAGE_SIZE = 20

export type DemoMessageScenario = {
  feeds: typeof DEMO_FEEDS
  activeFeedId: string
  selectedFeedId: string
  pendingFeedId: string | null
  activeFeed: ReturnType<typeof getDemoFeedDefinition>
  activeRuntime: MessageListRuntime<DemoMessage>
  messageCount: number
  loadedMessageCount: number
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  loadingBefore: boolean
  loadingAfter: boolean
  feedLoading: boolean
  eventStormRunning: boolean
  botPushActive: boolean
  highlightedMessageId: string | null
  highlightToken: number
  pendingOperation: string
  lastEvent: string
  selectFeed: (feedId: string) => void
  loadHistoryBatch: () => void
  loadFutureBatch: () => void
  appendMessage: () => void
  appendLongBurst: () => void
  toggleEventStorm: () => void
  toggleBotPush: () => void
  editMessage: (messageId: string, nextBody: string) => void
  deleteMessage: (messageId: string) => void
  reactToMessage: (messageId: string) => void
  toggleDynamicHeight: () => void
  sendMessage: (body: string) => boolean
  retryFailedSend: () => boolean
  followBottom: () => void
  jumpToQuote: () => void
  clearFeed: (feedId: string) => void
  rememberRuntimeViewportAnchor: (event: ViewportAnchorChangedEvent) => void
}

export function useDemoMessageScenario(
  runtimeCache: DemoFeedRuntimeCache,
): DemoMessageScenario {
  const [activeFeedId, setActiveFeedId] = useState(DEMO_FEEDS[0].id)
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [lastEvent, setLastEvent] = useState('bootstrapping latest segment')
  const [feedLoading, setFeedLoading] = useState(true)
  const dataRuntimesRef = useRef(new Map<string, MessageListDataRuntime<DemoMessage>>())
  const savedAnchorsRef = useRef(new Map<string, MessageIdentityAnchor>())
  const dynamicHeightExpandedRef = useRef(false)
  const runtime = runtimeCache.getRuntime(activeFeedId)
  const activeFeed = useMemo(
    () => getDemoFeedDefinition(activeFeedId),
    [activeFeedId],
  )

  const getDataRuntime = useCallback((feedId: string) => {
    const existing = dataRuntimesRef.current.get(feedId)

    if (existing) {
      return existing
    }

    const next = createMessageListDataRuntime<DemoMessage>({
      feedId,
      itemBudget: 120,
    })
    dataRuntimesRef.current.set(feedId, next)
    return next
  }, [])

  const publishSegment = useCallback((
    dataRuntime: MessageListDataRuntime<DemoMessage>,
  ) => {
    const segment = dataRuntime.getSegment()
    const nextMessages = segment.items
      .map((item) => item.message)
      .filter((message): message is DemoMessage => Boolean(message))
    if (segment.feedId === activeFeedId) {
      setMessages(nextMessages)
    }
    runtimeCache.getRuntime(segment.feedId).applyLoadedSegment(segment)
  }, [activeFeedId, runtimeCache])

  const handleSemanticEvent = useCallback((
    event: MessageListRuntimeEvent,
  ): Promise<{ message: string } | null> | null => {
    if (!isRuntimeNeedEvent(event) || event.feedId !== activeFeedId) {
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
      return applyLatestRequest({ ...context, feedId: event.feedId, event })
    }
    if (event.type === 'needMessagesAround') {
      return applyAroundRequest({ ...context, event })
    }
    if (event.type === 'needMoreBefore' || event.type === 'needMoreAfter') {
      return applyEdgeRequest({ ...context, event })
    }
    return null
  }, [activeFeedId, getDataRuntime, publishSegment, runtimeCache])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = runtime.subscribeRuntimeEvent((event) => {
      const request = handleSemanticEvent(event)
      if (!request) {
        return
      }
      void request.then((result) => {
        if (!cancelled && result) {
          setLastEvent(result.message)
        }
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [handleSemanticEvent, runtime])

  useEffect(() => {
    let cancelled = false
    const dataRuntime = getDataRuntime(activeFeedId)
    const cachedSegment = dataRuntime.getSegment()

    if (cachedSegment.items.length > 0) {
      void Promise.resolve().then(() => {
        if (cancelled) {
          return
        }

        publishSegment(dataRuntime)
        setFeedLoading(false)
        const savedAnchor = savedAnchorsRef.current.get(activeFeedId)
        if (savedAnchor) {
          runtime.restoreToMessage(savedAnchor)
        } else {
          runtime.scrollToLatest()
        }
      })
      return () => {
        cancelled = true
      }
    }

    void applyLatestRequest({
      dataRuntime,
      feedId: activeFeedId,
      runtime,
      publishSegment,
      pageSize: PAGE_SIZE,
    }).then((result) => {
      if (!cancelled) {
        setLastEvent(result.message)
        setFeedLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeFeedId, getDataRuntime, publishSegment, runtime])

  const appendMessage = useCallback(() => {
    const sequence = (messages.at(-1)?.sequence ?? 0) + 1
    const nextMessages = [
      ...messages,
      createNewestMessage(activeFeedId, sequence, 'Appended demo message'),
    ]
    replaceDemoFeedMessages(activeFeedId, nextMessages)
    const dataRuntime = getDataRuntime(activeFeedId)
    dataRuntime.patchItems(nextMessages.map(toDemoMessageDataItem))
    publishSegment(dataRuntime)
    setLastEvent('appended message')
  }, [activeFeedId, getDataRuntime, messages, publishSegment])

  const toggleDynamicHeight = useCallback(() => {
    if (messages.length === 0) {
      return
    }

    dynamicHeightExpandedRef.current = !dynamicHeightExpandedRef.current
    const targetIndex = Math.floor(messages.length / 2)
    const nextMessages = messages.map((message, index) => index === targetIndex
      ? {
          ...message,
          body: dynamicHeightExpandedRef.current
            ? `${message.body}\n\n${message.body}\n\n${message.body}`
            : message.body.split('\n\n')[0],
        }
      : message)
    replaceDemoFeedMessages(activeFeedId, nextMessages)
    const dataRuntime = getDataRuntime(activeFeedId)
    dataRuntime.patchItems(nextMessages.map(toDemoMessageDataItem))
    publishSegment(dataRuntime)
    setLastEvent('patched dynamic row height')
  }, [activeFeedId, getDataRuntime, messages, publishSegment])

  const rememberRuntimeViewportAnchor = useCallback((
    event: ViewportAnchorChangedEvent,
  ) => {
    if (event.anchor) {
      savedAnchorsRef.current.set(event.feedId, event.anchor)
    }
  }, [])

  const selectFeed = useCallback((feedId: string) => {
    if (feedId !== activeFeedId) {
      setFeedLoading(true)
    }
    setActiveFeedId(feedId)
  }, [activeFeedId])

  const runtimeSnapshot = runtime.getSnapshot()

  return {
    feeds: DEMO_FEEDS,
    activeFeedId,
    selectedFeedId: activeFeedId,
    pendingFeedId: null,
    activeFeed,
    activeRuntime: runtime,
    messageCount: messages.length,
    loadedMessageCount: messages.length,
    hasMoreBefore: runtimeSnapshot.segmentMeta.hasMoreBefore,
    hasMoreAfter: runtimeSnapshot.segmentMeta.hasMoreAfter,
    loadingBefore: runtimeSnapshot.edgeState.before.status === 'loading',
    loadingAfter: runtimeSnapshot.edgeState.after.status === 'loading',
    feedLoading,
    eventStormRunning: false,
    botPushActive: false,
    highlightedMessageId: null,
    highlightToken: 0,
    pendingOperation: feedLoading ? 'loading' : 'idle',
    lastEvent,
    selectFeed,
    loadHistoryBatch: () => setLastEvent('history loads through runtime before edge'),
    loadFutureBatch: () => setLastEvent('future loads through runtime after edge'),
    appendMessage,
    appendLongBurst: appendMessage,
    toggleEventStorm: () => setLastEvent('event storm deferred to Phase 7'),
    toggleBotPush: () => setLastEvent('bot push deferred to Phase 7'),
    editMessage: () => setLastEvent('edit deferred to data runtime hardening'),
    deleteMessage: () => setLastEvent('delete deferred to data runtime hardening'),
    reactToMessage: () => setLastEvent('reaction deferred'),
    toggleDynamicHeight,
    sendMessage(body) {
      if (!body.trim()) {
        return false
      }
      appendMessage()
      return true
    },
    retryFailedSend: () => false,
    followBottom: () => runtime.scrollToLatest(),
    jumpToQuote: () => {
      const first = messages[0]
      if (first) {
        runtime.scrollToMessage({
          feedId: activeFeedId,
          stableId: first.id,
          serverId: first.id,
        })
      }
      setLastEvent('jump command sent to runtime')
    },
    clearFeed(feedId) {
      replaceDemoFeedMessages(feedId, [])
      if (feedId === activeFeedId) {
        const dataRuntime = getDataRuntime(feedId)
        dataRuntime.resetLatest({
          items: [],
          hasMoreBefore: false,
          hasMoreAfter: false,
        })
        publishSegment(dataRuntime)
      }
      setLastEvent(`cleared ${feedId}`)
    },
    rememberRuntimeViewportAnchor,
  }
}

function isRuntimeNeedEvent(event: MessageListRuntimeEvent): event is Extract<
  MessageListRuntimeEvent,
  | { type: 'needLatestMessages' }
  | { type: 'needMessagesAround' }
  | { type: 'needMoreBefore' }
  | { type: 'needMoreAfter' }
> {
  return event.type === 'needLatestMessages' ||
    event.type === 'needMessagesAround' ||
    event.type === 'needMoreBefore' ||
    event.type === 'needMoreAfter'
}
