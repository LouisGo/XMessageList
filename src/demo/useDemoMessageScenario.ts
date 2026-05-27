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
  createDemoMessages,
  createNewestMessage,
  toDemoMessageDataItem,
  type DemoMessage,
} from './demoData'
import { DEMO_FEEDS, getDemoFeedDefinition } from './demoFeeds'
import {
  appendDemoFeedMessages,
  readDemoFeedMessages,
  replaceDemoFeedMessages,
} from './demoMessageApi'
import {
  applyAroundRequest,
  applyEdgeRequest,
  applyLatestRequest,
  toRuntimeAnchor,
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
  resetE2EScenario: (scenarioId: string) => Promise<void>
  streamCurrentRow: () => void
  deferNextEdgeResponse: (delayMs: number) => void
  sendOptimisticMessage: () => void
  alignPendingOptimisticAtStart: () => void
  resolveOptimisticRemap: () => void
  sendOptimisticAndRemap: () => Promise<void>
}

type PendingOptimisticRemap = {
  feedId: string
  localId: string
  serverId: string
  remap: Parameters<MessageListDataRuntime<DemoMessage>['applyIdentityRemap']>[0][number]
}

export function useDemoMessageScenario(
  runtimeCache: DemoFeedRuntimeCache,
): DemoMessageScenario {
  const [activeFeedId, setActiveFeedId] = useState(DEMO_FEEDS[0].id)
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [lastEvent, setLastEvent] = useState('bootstrapping latest segment')
  const [feedLoading, setFeedLoading] = useState(true)
  const [eventStormRunning, setEventStormRunning] = useState(false)
  const [botPushActive, setBotPushActive] = useState(false)
  const eventStormTimerRef = useRef<number | null>(null)
  const botPushTimerRef = useRef<number | null>(null)
  const dataRuntimesRef = useRef(new Map<string, MessageListDataRuntime<DemoMessage>>())
  const savedAnchorsRef = useRef(new Map<string, MessageIdentityAnchor>())
  const dynamicHeightExpandedRef = useRef(false)
  const deferredEdgeResponseDelayMsRef = useRef(0)
  const pendingOptimisticRemapRef = useRef<PendingOptimisticRemap | null>(null)
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

  const publishActivePatch = useCallback((
    feedId: string,
    items: DemoMessage[],
  ) => {
    const dataRuntime = getDataRuntime(feedId)
    dataRuntime.patchItems(items.map(toDemoMessageDataItem))
    publishSegment(dataRuntime)
  }, [getDataRuntime, publishSegment])

  const appendGeneratedMessages = useCallback((
    feedId: string,
    count: number,
    body: string,
  ): DemoMessage[] => {
    const allMessages = readDemoFeedMessages(feedId)
    const lastSequence = allMessages.at(-1)?.sequence ?? 0
    const nextMessages = Array.from({ length: count }, (_, index) =>
      createNewestMessage(feedId, lastSequence + index + 1, body),
    )

    appendDemoFeedMessages(feedId, nextMessages)
    publishActivePatch(feedId, nextMessages)
    return nextMessages
  }, [publishActivePatch])

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
      const delayMs = consumeDeferredEdgeResponseDelay(deferredEdgeResponseDelayMsRef)
      if (delayMs > 0) {
        return wait(delayMs).then(() => applyEdgeRequest({ ...context, event }))
      }

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
        runtime.scrollToLatest()
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeFeedId, getDataRuntime, publishSegment, runtime])

  const appendMessage = useCallback(() => {
    appendGeneratedMessages(activeFeedId, 1, 'Appended demo message')
    setLastEvent('appended message')
  }, [activeFeedId, appendGeneratedMessages])

  const appendLongBurst = useCallback(() => {
    appendGeneratedMessages(activeFeedId, 8, 'Burst append from demo mock stream')
    setLastEvent('appended burst')
  }, [activeFeedId, appendGeneratedMessages])

  const loadEdgeBatch = useCallback((edge: 'before' | 'after') => {
    const dataRuntime = getDataRuntime(activeFeedId)
    const segment = dataRuntime.getSegment()
    const boundaryItem = edge === 'before'
      ? segment.items[0]
      : segment.items.at(-1)
    const boundaryMessage = boundaryItem?.message

    if (!boundaryMessage) {
      setLastEvent(`no ${edge} boundary loaded`)
      return
    }

    const allMessages = readDemoFeedMessages(activeFeedId)
    const boundaryIndex = allMessages.findIndex((message) =>
      message.id === boundaryMessage.id
    )

    if (boundaryIndex < 0) {
      setLastEvent(`${edge} boundary missing from mock store`)
      return
    }

    const request = dataRuntime.createRequestToken(edge)
    const start = edge === 'before'
      ? Math.max(0, boundaryIndex - PAGE_SIZE)
      : boundaryIndex + 1
    const end = edge === 'before'
      ? boundaryIndex
      : Math.min(allMessages.length, boundaryIndex + 1 + PAGE_SIZE)
    const incoming = allMessages.slice(start, end)
    const applyInput = {
      requestToken: request.requestToken,
      items: incoming.map(toDemoMessageDataItem),
      hasMoreBefore: edge === 'before' ? start > 0 : segment.hasMoreBefore,
      hasMoreAfter: edge === 'after' ? end < allMessages.length : segment.hasMoreAfter,
      anchor: segment.anchor,
      anchorStatus: segment.anchorStatus,
    }
    const result = edge === 'before'
      ? dataRuntime.extendBefore(applyInput)
      : dataRuntime.extendAfter(applyInput)

    if (result.applied) {
      publishSegment(dataRuntime)
      setLastEvent(`manually loaded ${incoming.length} ${edge} messages`)
      return
    }

    setLastEvent(`ignored stale manual ${edge} response`)
  }, [activeFeedId, getDataRuntime, publishSegment])

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

  const streamCurrentRow = useCallback(() => {
    const visibleKey = runtime.getEvidence().visibleRows[0]?.key
    const current = getDataRuntime(activeFeedId).getSegment()
    const target = current.items.find((item) => item.key === visibleKey) ??
      current.items[Math.floor(current.items.length / 2)]
    const message = target?.message

    if (!message) {
      setLastEvent('no visible row to stream')
      return
    }

    const streamed = {
      ...message,
      body: `${message.body}\n\nStreaming update ${Date.now()}`,
    }
    replaceDemoFeedMessages(
      activeFeedId,
      readDemoFeedMessages(activeFeedId).map((candidate) =>
        candidate.id === streamed.id ? streamed : candidate,
      ),
    )
    publishActivePatch(activeFeedId, [streamed])
    setLastEvent('streamed current row')
  }, [activeFeedId, getDataRuntime, publishActivePatch, runtime])

  const sendOptimisticMessage = useCallback(() => {
    const dataRuntime = getDataRuntime(activeFeedId)
    const allMessages = readDemoFeedMessages(activeFeedId)
    const nextSequence = (allMessages.at(-1)?.sequence ?? 0) + 1
    const localId = `local-${Date.now()}`
    const committedMessage = createNewestMessage(
      activeFeedId,
      nextSequence,
      'Optimistic send committed by server',
    )
    const tailMessages = Array.from({ length: 6 }, (_, index) =>
      createNewestMessage(
        activeFeedId,
        nextSequence + index + 1,
        'Committed tail message after optimistic send',
      ),
    )
    const serverId = committedMessage.id
    const optimistic: DemoMessage = {
      ...committedMessage,
      id: localId,
      body: 'Optimistic send awaiting server id',
    }

    appendDemoFeedMessages(activeFeedId, [committedMessage, ...tailMessages])
    pendingOptimisticRemapRef.current = {
      feedId: activeFeedId,
      localId,
      serverId,
      remap: {
        from: {
          feedId: activeFeedId,
          stableId: localId,
          localId,
        },
        to: {
          feedId: activeFeedId,
          stableId: serverId,
          serverId,
        },
        previousKey: localId,
        nextKey: serverId,
      },
    }
    dataRuntime.patchItems([
      {
        ...toDemoMessageDataItem(optimistic),
        rowKind: 'optimistic',
        identity: {
          feedId: activeFeedId,
          stableId: localId,
          localId,
          version: 1,
        },
      },
      ...tailMessages.map(toDemoMessageDataItem),
    ])
    publishSegment(dataRuntime)
    setLastEvent('optimistic local identity published')
  }, [activeFeedId, getDataRuntime, publishSegment])

  const alignPendingOptimisticAtStart = useCallback(() => {
    const pending = pendingOptimisticRemapRef.current

    if (!pending || pending.feedId !== activeFeedId) {
      setLastEvent('no optimistic message to align')
      return
    }

    runtime.scrollToMessage({
      feedId: pending.feedId,
      stableId: pending.localId,
      localId: pending.localId,
    }, { align: 'start' })
    setLastEvent('aligned optimistic row at viewport start')
  }, [activeFeedId, runtime])

  const resolveOptimisticRemap = useCallback(() => {
    const pending = pendingOptimisticRemapRef.current

    if (!pending || pending.feedId !== activeFeedId) {
      setLastEvent('no optimistic remap pending')
      return
    }

    const dataRuntime = getDataRuntime(activeFeedId)
    dataRuntime.applyIdentityRemap([pending.remap])
    publishSegment(dataRuntime)
    pendingOptimisticRemapRef.current = null
    setLastEvent('optimistic identity remapped to server id')
  }, [activeFeedId, getDataRuntime, publishSegment])

  const sendOptimisticAndRemap = useCallback(async () => {
    sendOptimisticMessage()
    await wait(0)
    resolveOptimisticRemap()
  }, [resolveOptimisticRemap, sendOptimisticMessage])

  const deferNextEdgeResponse = useCallback((delayMs: number) => {
    deferredEdgeResponseDelayMsRef.current = Math.max(0, delayMs)
  }, [])

  const stopLongRunningMocks = useCallback(() => {
    if (eventStormTimerRef.current !== null) {
      window.clearInterval(eventStormTimerRef.current)
      eventStormTimerRef.current = null
    }
    if (botPushTimerRef.current !== null) {
      window.clearInterval(botPushTimerRef.current)
      botPushTimerRef.current = null
    }
    setEventStormRunning(false)
    setBotPushActive(false)
  }, [])

  const toggleEventStorm = useCallback(() => {
    if (eventStormTimerRef.current !== null) {
      stopLongRunningMocks()
      setLastEvent('event storm stopped')
      return
    }

    const feedId = activeFeedId
    setEventStormRunning(true)
    eventStormTimerRef.current = window.setInterval(() => {
      appendGeneratedMessages(feedId, 2, 'Event storm mock message')
    }, 160)
    setLastEvent('event storm started')
  }, [activeFeedId, appendGeneratedMessages, stopLongRunningMocks])

  const toggleBotPush = useCallback(() => {
    if (botPushTimerRef.current !== null) {
      stopLongRunningMocks()
      setLastEvent('bot push stopped')
      return
    }

    const feedId = activeFeedId
    setBotPushActive(true)
    botPushTimerRef.current = window.setInterval(() => {
      appendGeneratedMessages(feedId, 1, 'Bot push mock message')
    }, 500)
    setLastEvent('bot push started')
  }, [activeFeedId, appendGeneratedMessages, stopLongRunningMocks])

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

  const resetE2EScenario = useCallback(async (scenarioId: string) => {
    stopLongRunningMocks()
    savedAnchorsRef.current.clear()
    dynamicHeightExpandedRef.current = false
    deferredEdgeResponseDelayMsRef.current = 0
    pendingOptimisticRemapRef.current = null

    const feedId = DEMO_FEEDS[0].id
    const allMessages = createDemoMessages(resolveScenarioTotalMessages(scenarioId), feedId)
    replaceDemoFeedMessages(feedId, allMessages)
    const dataRuntime = getDataRuntime(feedId)
    const runtimeForFeed = runtimeCache.getRuntime(feedId)

    if (usesAroundBootstrap(scenarioId)) {
      const targetIndex = Math.floor(allMessages.length / 2)
      const target = allMessages[targetIndex] ?? allMessages[0]
      const before = scenarioId === 'underflow.dual-edge-arbitration' ? 1 : 8
      const after = scenarioId === 'underflow.dual-edge-arbitration' ? 1 : 8
      const start = Math.max(0, targetIndex - before)
      const end = Math.min(allMessages.length, targetIndex + after + 1)
      dataRuntime.resetAround({
        target: {
          feedId,
          stableId: target.id,
          serverId: target.id,
        },
        items: allMessages.slice(start, end).map(toDemoMessageDataItem),
        hasMoreBefore: start > 0,
        hasMoreAfter: end < allMessages.length,
        anchor: {
          feedId,
          stableId: target.id,
          serverId: target.id,
        },
        anchorStatus: 'normal',
      })
    } else {
      const latest = allMessages.slice(Math.max(0, allMessages.length - PAGE_SIZE))
      dataRuntime.resetLatest({
        items: latest.map(toDemoMessageDataItem),
        hasMoreBefore: allMessages.length > PAGE_SIZE,
        hasMoreAfter: false,
        anchor: toRuntimeAnchor(feedId, latest.at(-1)?.id),
        anchorStatus: 'normal',
      })
    }

    const segment = dataRuntime.getSegment()
    setActiveFeedId(feedId)
    setMessages(segment.items
      .map((item) => item.message)
      .filter((message): message is DemoMessage => Boolean(message)))
    setFeedLoading(false)
    setLastEvent(`reset ${scenarioId}`)
    runtimeForFeed.applyLoadedSegment(segment)
    await Promise.resolve()
    if (!usesAroundBootstrap(scenarioId)) {
      runtimeForFeed.scrollToLatest()
    }
  }, [getDataRuntime, runtimeCache, stopLongRunningMocks])

  useEffect(() => () => {
    stopLongRunningMocks()
  }, [stopLongRunningMocks])

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
    eventStormRunning,
    botPushActive,
    highlightedMessageId: null,
    highlightToken: 0,
    pendingOperation: feedLoading ? 'loading' : 'idle',
    lastEvent,
    selectFeed,
    loadHistoryBatch: () => loadEdgeBatch('before'),
    loadFutureBatch: () => loadEdgeBatch('after'),
    appendMessage,
    appendLongBurst,
    toggleEventStorm,
    toggleBotPush,
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
    resetE2EScenario,
    streamCurrentRow,
    deferNextEdgeResponse,
    sendOptimisticMessage,
    alignPendingOptimisticAtStart,
    resolveOptimisticRemap,
    sendOptimisticAndRemap,
  }
}

function consumeDeferredEdgeResponseDelay(ref: { current: number }): number {
  const delayMs = ref.current
  ref.current = 0
  return delayMs
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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

function resolveScenarioTotalMessages(scenarioId: string): number {
  if (scenarioId === 'underflow.dual-edge-arbitration') {
    return 18
  }

  return 80
}

function usesAroundBootstrap(scenarioId: string): boolean {
  return scenarioId === 'paging.after-native-thumb-rebound' ||
    scenarioId === 'underflow.dual-edge-arbitration' ||
    scenarioId === 'destination.jump-in-segment' ||
    scenarioId === 'follow-bottom.partial-segment'
}
