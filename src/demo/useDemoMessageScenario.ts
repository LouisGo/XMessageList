import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MessageListRuntime,
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
  getLatestMessages,
  getMessagesAround,
  replaceDemoFeedMessages,
} from './demoMessageApi'
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
    setMessages(nextMessages)
    runtime.applyLoadedSegment(segment)
  }, [runtime])

  useEffect(() => {
    let cancelled = false
    void getLatestMessages({ feedId: activeFeedId, count: PAGE_SIZE })
      .then((resp) => {
        if (cancelled || !resp.ok) {
          return
        }
        const dataRuntime = getDataRuntime(activeFeedId)
        dataRuntime.resetLatest({
          items: resp.messages.map(toDemoMessageDataItem),
          hasMoreBefore: resp.hasMoreBefore,
          hasMoreAfter: resp.hasMoreAfter,
          anchor: resp.anchor.messageId
            ? {
                feedId: resp.feedId,
                stableId: resp.anchor.messageId,
                serverId: resp.anchor.messageId,
              }
            : undefined,
          anchorStatus: resp.anchorStatus,
        })
        publishSegment(dataRuntime)
        setLastEvent(`loaded ${resp.messages.length} latest messages`)
      })
      .finally(() => {
        if (!cancelled) {
          setFeedLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeFeedId, getDataRuntime, publishSegment])

  useEffect(() => runtime.subscribeRuntimeEvent((event) => {
    if (event.type === 'needLatestMessages') {
      setLastEvent('runtime requested latest messages')
    }
    if (event.type === 'needMessagesAround') {
      setLastEvent('runtime requested messages around anchor')
    }
  }), [runtime])

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

  return {
    feeds: DEMO_FEEDS,
    activeFeedId,
    selectedFeedId: activeFeedId,
    pendingFeedId: null,
    activeFeed,
    activeRuntime: runtime,
    messageCount: messages.length,
    loadedMessageCount: messages.length,
    hasMoreBefore: false,
    hasMoreAfter: false,
    loadingBefore: false,
    loadingAfter: false,
    feedLoading,
    eventStormRunning: false,
    botPushActive: false,
    highlightedMessageId: null,
    highlightToken: 0,
    pendingOperation: feedLoading ? 'loading' : 'idle',
    lastEvent,
    selectFeed: setActiveFeedId,
    loadHistoryBatch: () => setLastEvent('history request deferred to Phase 5'),
    loadFutureBatch: () => setLastEvent('future request deferred to Phase 5'),
    appendMessage,
    appendLongBurst: appendMessage,
    toggleEventStorm: () => setLastEvent('event storm deferred to Phase 7'),
    toggleBotPush: () => setLastEvent('bot push deferred to Phase 7'),
    editMessage: () => setLastEvent('edit deferred to data runtime hardening'),
    deleteMessage: () => setLastEvent('delete deferred to data runtime hardening'),
    reactToMessage: () => setLastEvent('reaction deferred'),
    toggleDynamicHeight: () => setLastEvent('dynamic height deferred to Phase 5'),
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
        const target = {
          feedId: activeFeedId,
          stableId: first.id,
          serverId: first.id,
        }
        void getMessagesAround({
          feedId: activeFeedId,
          anchor: { messageId: first.id, position: first.sequence },
          before: 5,
          after: 5,
        }).then((resp) => {
          if (!resp.ok) {
            return
          }
          const dataRuntime = getDataRuntime(activeFeedId)
          dataRuntime.resetAround({
            target,
            items: resp.messages.map(toDemoMessageDataItem),
            hasMoreBefore: resp.hasMoreBefore,
            hasMoreAfter: resp.hasMoreAfter,
            anchor: target,
            anchorStatus: resp.anchorStatus,
          })
          publishSegment(dataRuntime)
        })
      }
      setLastEvent('jump request entered data runtime')
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
    rememberRuntimeViewportAnchor: () => undefined,
  }
}
