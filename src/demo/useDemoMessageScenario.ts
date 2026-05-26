import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LoadedSegment,
  MessageListRuntime,
  ViewportAnchorChangedEvent,
} from '../runtime'
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
  const revisionRef = useRef(0)
  const runtime = runtimeCache.getRuntime(activeFeedId)
  const activeFeed = useMemo(
    () => getDemoFeedDefinition(activeFeedId),
    [activeFeedId],
  )

  const publish = useCallback((
    nextMessages: DemoMessage[],
    modifier: LoadedSegment<DemoMessage>['modifier'],
    hasMoreBefore: boolean,
    hasMoreAfter: boolean,
  ) => {
    const nextRevision = revisionRef.current + 1
    revisionRef.current = nextRevision
    setMessages(nextMessages)
    runtime.applyLoadedSegment({
      feedId: activeFeedId,
      generation: 1,
      segmentRevision: nextRevision,
      items: nextMessages.map(toDemoMessageDataItem),
      hasMoreBefore,
      hasMoreAfter,
      modifier,
    })
  }, [activeFeedId, runtime])

  useEffect(() => {
    let cancelled = false
    void getLatestMessages({ feedId: activeFeedId, count: PAGE_SIZE })
      .then((resp) => {
        if (cancelled || !resp.ok) {
          return
        }
        publish(resp.messages, { type: 'bootstrap' }, resp.hasMoreBefore, false)
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
  }, [activeFeedId, publish])

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
    publish(nextMessages, { type: 'patch', changedKeys: [] }, false, false)
    setLastEvent('appended message')
  }, [activeFeedId, messages, publish])

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
        void getMessagesAround({
          feedId: activeFeedId,
          anchor: { messageId: first.id, position: first.sequence },
          before: 5,
          after: 5,
        })
      }
      setLastEvent('jump request kept semantic; viewport wiring is later')
    },
    clearFeed(feedId) {
      replaceDemoFeedMessages(feedId, [])
      if (feedId === activeFeedId) {
        publish([], { type: 'reset-latest' }, false, false)
      }
      setLastEvent(`cleared ${feedId}`)
    },
    rememberRuntimeViewportAnchor: () => undefined,
  }
}
