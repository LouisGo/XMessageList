import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MessageListRuntimeEvent,
  ViewportAnchorChangedEvent,
} from '../runtime'
import {
  createMessageListDataRuntime,
  type MessageListDataRuntime,
} from '../runtime/data'
import { toDemoMessageDataItem, type DemoMessage } from './demoData'
import { DEMO_FEEDS, getDemoFeedDefinition } from './demoFeeds'
import {
  flushDemoFeedPersistence,
  loadDemoViewportAnchor,
  loadDemoFeedMessages,
  replaceDemoFeedMessages,
  saveDemoViewportAnchor,
} from './demoMessageApi'
import {
  createDemoRequestId,
  writeDemoLog,
} from './demoLocalStoreClient'
import {
  applyAroundRequest,
  applyEdgeRequest,
  applyLatestRequest,
  type DemoRequestResult,
  toRuntimeAnchor,
} from './demoScenarioRequests'
import type { AdvancedMockPublishResult } from './demoAdvancedMockScenarios'
import {
  clearHighlightTimer,
  consumeDeferredEdgeResponseDelay,
  isRuntimeNeedEvent,
  resolveChangedMessageKeys,
  resolveLoadedBounds,
  wait,
  waitMockDelay,
} from './scenario/demoScenarioHelpers'
import {
  prepareDemoE2EScenario,
  resolveTrimProtectKey,
  restoreAroundAnchor,
  type SavedRuntimeAnchor,
  toPersistedViewportAnchor,
} from './scenario/demoScenarioRuntimeHelpers'
import { useDemoEdgeBatchLoader } from './scenario/useDemoEdgeBatchLoader'
import { useDemoEdgeLoadingState } from './scenario/useDemoEdgeLoadingState'
import { useDelayedVisibility } from './scenario/useDelayedVisibility'
import { useDemoGeneratedAppends } from './scenario/useDemoGeneratedAppends'
import { useDemoLongRunningMocks } from './scenario/useDemoLongRunningMocks'
import { useDemoMessageCommands } from './scenario/useDemoMessageCommands'
import { useDemoMessageMutations } from './scenario/useDemoMessageMutations'
import { useDemoOptimisticRemap } from './scenario/useDemoOptimisticRemap'
import type { DemoMessageScenario } from './scenario/demoScenarioTypes'
import type { DemoFeedRuntimeCache } from './useDemoFeedRuntimeCache'
export type { DemoMessageScenario } from './scenario/demoScenarioTypes'
const PAGE_SIZE = 20
const LONG_BURST_SIZE = 4
const DEMO_ITEM_BUDGET = 40
const EDGE_LOAD_DELAY_BASE_MS = 100
const APPEND_DELAY_BASE_MS = 50
const LONG_BURST_DELAY_BASE_MS = 620
const SEND_DELAY_BASE_MS = 60
const SESSION_LOADING_OVERLAY_DELAY_MS = 200
export function useDemoMessageScenario(
  runtimeCache: DemoFeedRuntimeCache,
): DemoMessageScenario {
  const [activeFeedId, setActiveFeedId] = useState(DEMO_FEEDS[0].id)
  const activeFeedIdRef = useRef(activeFeedId)
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [messageCount, setMessageCount] = useState(0)
  const [lastEvent, setLastEvent] = useState('bootstrapping latest segment')
  const [feedLoading, setFeedLoading] = useState(true)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [highlightToken, setHighlightToken] = useState(0)
  const highlightTimerRef = useRef<number | null>(null)
  const dataRuntimesRef = useRef(new Map<string, MessageListDataRuntime<DemoMessage>>())
  const savedAnchorsRef = useRef(new Map<string, SavedRuntimeAnchor>())
  const deferredEdgeResponseDelayMsRef = useRef(0)
  const deferredSessionResponseDelayMsRef = useRef(0)
  const bootstrapTokenRef = useRef(0)
  const { loadingBefore, loadingAfter, setEdgeLoading } = useDemoEdgeLoadingState()
  const [sessionLoadingOverlayVisible, resetSessionLoadingOverlay] =
    useDelayedVisibility(feedLoading, SESSION_LOADING_OVERLAY_DELAY_MS)
  const runtime = runtimeCache.getRuntime(activeFeedId)
  const activeFeed = useMemo(
    () => getDemoFeedDefinition(activeFeedId),
    [activeFeedId],
  )
  useEffect(() => {
    activeFeedIdRef.current = activeFeedId
  }, [activeFeedId])
  const isActiveFeed = useCallback((feedId: string) =>
    activeFeedIdRef.current === feedId, [])
  const getDataRuntime = useCallback((feedId: string) => {
    const existing = dataRuntimesRef.current.get(feedId)
    if (existing) {
      return existing
    }
    const next = createMessageListDataRuntime<DemoMessage>({
      feedId,
      itemBudget: DEMO_ITEM_BUDGET,
    })
    dataRuntimesRef.current.set(feedId, next)
    return next
  }, [])
  const publishSegment = useCallback((
    dataRuntime: MessageListDataRuntime<DemoMessage>,
  ) => {
    const runtimeForFeed = runtimeCache.getRuntime(dataRuntime.getSegment().feedId)
    const committedSegment = dataRuntime.getSegment()
    runtimeForFeed.applyLoadedSegment(committedSegment)
    const shouldProtectTail =
      runtimeForFeed.getSnapshot().bottomLockState === 'LOCKED'
    let segment = committedSegment
    for (let trimGuard = 0; trimGuard < 4; trimGuard += 1) {
      const trimmed = dataRuntime.trimToBudget(resolveTrimProtectKey(
        segment,
        runtimeForFeed.getViewportAnchor(),
        shouldProtectTail,
      ))
      if (trimmed === segment) {
        break
      }
      segment = trimmed
      runtimeForFeed.applyLoadedSegment(segment)
      if (segment.items.length <= DEMO_ITEM_BUDGET) {
        break
      }
    }
    const nextMessages = segment.items
      .map((item) => item.message)
      .filter((message): message is DemoMessage => Boolean(message))
    if (isActiveFeed(segment.feedId)) {
      setMessages(nextMessages)
    }
  }, [isActiveFeed, runtimeCache])
  const publishActivePatch = useCallback((
    feedId: string,
    items: DemoMessage[],
  ) => {
    const dataRuntime = getDataRuntime(feedId)
    dataRuntime.patchItems(items.map(toDemoMessageDataItem))
    publishSegment(dataRuntime)
  }, [getDataRuntime, publishSegment])
  const replaceLoadedMessages = useCallback(async (input: {
    feedId: string
    feedMessages: DemoMessage[]
    messages: DemoMessage[]
    changedKeys: string[]
    eventText: string
  }) => {
    const persistedMessages = replaceDemoFeedMessages(input.feedId, input.feedMessages)
    await flushDemoFeedPersistence(input.feedId)
    const dataRuntime = getDataRuntime(input.feedId)
    const currentSegment = dataRuntime.getSegment()
    const bounds = resolveLoadedBounds(input.feedMessages, input.messages)
    if (input.changedKeys.length > 0) {
      dataRuntime.replaceItems({
        items: input.messages.map(toDemoMessageDataItem),
        changedKeys: input.changedKeys,
        hasMoreBefore: bounds.hasMoreBefore ?? currentSegment.hasMoreBefore,
        hasMoreAfter: bounds.hasMoreAfter ?? currentSegment.hasMoreAfter,
        anchor: currentSegment.anchor,
        anchorStatus: currentSegment.anchorStatus,
      })
      publishSegment(dataRuntime)
    }
    if (isActiveFeed(input.feedId)) {
      setMessageCount(persistedMessages.length)
      setLastEvent(input.eventText)
    }
  }, [getDataRuntime, isActiveFeed, publishSegment])
  const applyAdvancedMockResult = useCallback(async (
    feedId: string,
    result: AdvancedMockPublishResult,
    previousMessages: DemoMessage[],
  ) => {
    await replaceLoadedMessages({
      feedId,
      feedMessages: result.feedMessages,
      messages: result.messages,
      changedKeys: resolveChangedMessageKeys(previousMessages, result.messages),
      eventText: result.eventText,
    })
  }, [replaceLoadedMessages])
  const handleSemanticEvent = useCallback((
    event: MessageListRuntimeEvent,
  ): Promise<DemoRequestResult | null> | null => {
    if (!isRuntimeNeedEvent(event) || !isActiveFeed(event.feedId)) {
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
      const request = async () => {
        await waitMockDelay(EDGE_LOAD_DELAY_BASE_MS)
        return applyLatestRequest({ ...context, feedId: event.feedId, event })
      }
      return request()
    }
    if (event.type === 'needMessagesAround') {
      const request = async () => {
        await waitMockDelay(EDGE_LOAD_DELAY_BASE_MS)
        return applyAroundRequest({ ...context, event })
      }
      return request()
    }
    if (event.type === 'needMoreBefore' || event.type === 'needMoreAfter') {
      const edge = event.type === 'needMoreBefore' ? 'before' : 'after'
      const delayMs = consumeDeferredEdgeResponseDelay(deferredEdgeResponseDelayMsRef)
      setEdgeLoading(edge, true)
      const request = async () => {
        await waitMockDelay(delayMs > 0 ? delayMs : EDGE_LOAD_DELAY_BASE_MS)
        return applyEdgeRequest({ ...context, event })
      }
      return request().finally(() => setEdgeLoading(edge, false))
    }
    return null
  }, [getDataRuntime, isActiveFeed, publishSegment, runtimeCache, setEdgeLoading])
  useEffect(() => {
    let cancelled = false
    const unsubscribe = runtime.subscribeRuntimeEvent((event) => {
      const eventFeedId = 'feedId' in event
        ? event.feedId
        : runtime.getSnapshot().feedId
      void writeDemoLog({
        requestId: createDemoRequestId('runtime.event'),
        operation: 'runtime.event',
        phase: 'info',
        feedId: eventFeedId,
        messageCount: getDataRuntime(eventFeedId).getSegment().items.length,
        details: event as unknown as Record<string, unknown>,
      })
      const request = handleSemanticEvent(event)
      if (!request) {
        return
      }
      void request.then((result) => {
        if (!cancelled && result) {
          if (typeof result.total === 'number') {
            setMessageCount(result.total)
          }
          setLastEvent(result.message)
        }
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [getDataRuntime, handleSemanticEvent, runtime])
  useEffect(() => {
    let cancelled = false
    const bootstrapToken = bootstrapTokenRef.current + 1
    bootstrapTokenRef.current = bootstrapToken
    const dataRuntime = getDataRuntime(activeFeedId)
    const cachedSegment = dataRuntime.getSegment()
    void (async () => {
      if (cancelled || bootstrapToken !== bootstrapTokenRef.current) {
        return
      }
      if (cachedSegment.items.length > 0) {
        const savedAnchor = savedAnchorsRef.current.get(activeFeedId)
        const allMessages = await loadDemoFeedMessages(activeFeedId)
        if (cancelled || bootstrapToken !== bootstrapTokenRef.current) {
          return
        }
        setMessageCount(allMessages.length)
        setFeedLoading(false)
        setLastEvent(savedAnchor
          ? `restored ${activeFeed.title}`
          : `loaded ${activeFeed.title}`)
        publishSegment(dataRuntime)
        if (savedAnchor) {
          await wait(60)
          if (cancelled || bootstrapToken !== bootstrapTokenRef.current) {
            return
          }
          runtime.restoreToMessage(savedAnchor.anchor, {
            align: 'start',
            offsetWithinMessage: savedAnchor.offsetWithinMessage ?? 0,
          })
        } else {
          runtime.scrollToLatest()
        }
        return
      }
      const sessionDelayMs = deferredSessionResponseDelayMsRef.current
      deferredSessionResponseDelayMsRef.current = 0
      if (sessionDelayMs > 0) {
        await wait(sessionDelayMs)
        if (cancelled || bootstrapToken !== bootstrapTokenRef.current) {
          return
        }
      }
      const persistedAnchor = await loadDemoViewportAnchor(activeFeedId)
      const persistedRuntimeAnchor = persistedAnchor
        ? toRuntimeAnchor(activeFeedId, persistedAnchor.messageId)
        : undefined
      if (persistedRuntimeAnchor) {
        const restored = await restoreAroundAnchor({
          dataRuntime,
          runtime,
          publishSegment,
          feedId: activeFeedId,
          pageSize: PAGE_SIZE,
          target: persistedRuntimeAnchor,
        })
        if (cancelled || bootstrapToken !== bootstrapTokenRef.current) {
          return
        }
        if (restored.status === 'applied') {
          if (typeof restored.total === 'number') {
            setMessageCount(restored.total)
          }
          savedAnchorsRef.current.set(activeFeedId, {
            anchor: persistedRuntimeAnchor,
            offsetWithinMessage: persistedAnchor.offsetWithinMessage,
          })
          setLastEvent(`restored ${activeFeed.title}`)
          setFeedLoading(false)
          await wait(60)
          if (cancelled || bootstrapToken !== bootstrapTokenRef.current) {
            return
          }
          runtime.restoreToMessage(persistedRuntimeAnchor, {
            align: 'start',
            offsetWithinMessage: persistedAnchor.offsetWithinMessage ?? 0,
          })
          return
        }
      }
      const result = await applyLatestRequest({
        dataRuntime,
        feedId: activeFeedId,
        runtime,
        publishSegment,
        pageSize: PAGE_SIZE,
        isStale: () => cancelled || bootstrapToken !== bootstrapTokenRef.current,
      })
      if (!cancelled && bootstrapToken === bootstrapTokenRef.current) {
        if (typeof result.total === 'number') {
          setMessageCount(result.total)
        }
        setLastEvent(result.message)
        setFeedLoading(false)
        runtime.scrollToLatest()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeFeed, activeFeedId, getDataRuntime, publishSegment, runtime])
  const {
    appendMessage,
    appendMessages,
    appendLongBurst,
  } = useDemoGeneratedAppends({
    activeFeedId,
    appendDelayBaseMs: APPEND_DELAY_BASE_MS,
    getDataRuntime,
    isActiveFeed,
    longBurstDelayBaseMs: LONG_BURST_DELAY_BASE_MS,
    longBurstSize: LONG_BURST_SIZE,
    publishActivePatch,
    setLastEvent,
    setMessageCount,
  })
  const loadEdgeBatch = useDemoEdgeBatchLoader({
    activeFeedId,
    getDataRuntime,
    isActiveFeed,
    pageSize: PAGE_SIZE,
    loadingDelayBaseMs: EDGE_LOAD_DELAY_BASE_MS,
    publishSegment,
    setEdgeLoading,
    setLastEvent,
    setMessageCount,
  })
  const {
    resetMessageMutationState,
    editMessage,
    deleteMessage,
    reactToMessage,
    toggleDynamicHeight,
    streamCurrentRow,
  } = useDemoMessageMutations({
    activeFeedId,
    runtime,
    getDataRuntime,
    replaceLoadedMessages,
    setLastEvent,
  })
  const {
    resetOptimisticRemap,
    sendOptimisticMessage,
    alignPendingOptimisticAtStart,
    resolveOptimisticRemap,
    sendOptimisticAndRemap,
  } = useDemoOptimisticRemap({
    activeFeedId,
    runtime,
    getDataRuntime,
    isActiveFeed,
    publishSegment,
    setLastEvent,
    onMessageCountChange: setMessageCount,
  })
  const deferNextEdgeResponse = useCallback((delayMs: number) => {
    deferredEdgeResponseDelayMsRef.current = Math.max(0, delayMs)
  }, [])
  const deferNextSessionResponse = useCallback((delayMs: number) => {
    deferredSessionResponseDelayMsRef.current = Math.max(0, delayMs)
  }, [])
  const {
    eventStormRunning,
    botPushActive,
    stopLongRunningMocks,
    toggleEventStorm,
    toggleBotPush,
  } = useDemoLongRunningMocks({
    activeFeedId,
    getDataRuntime,
    applyAdvancedMockResult,
    setLastEvent,
  })
  const {
    sendMessage,
    followBottom,
    jumpToQuote,
    clearFeed,
  } = useDemoMessageCommands({
    activeFeedId,
    runtime,
    getDataRuntime,
    isActiveFeed,
    publishSegment,
    pageSize: PAGE_SIZE,
    sendDelayBaseMs: SEND_DELAY_BASE_MS,
    setMessageCount,
    setLastEvent,
    highlightState: {
      setHighlightedMessageId,
      setHighlightToken,
      highlightTimerRef,
    },
  })
  const rememberRuntimeViewportAnchor = useCallback((
    event: ViewportAnchorChangedEvent,
  ) => {
    const eventRuntime = runtimeCache.getRuntime(event.feedId)
    const snapshot = eventRuntime.getSnapshot()
    if (
      snapshot.generation !== event.generation ||
      snapshot.segmentRevision !== event.segmentRevision
    ) {
      return
    }
    const anchor = event.anchor
    if (anchor) {
      savedAnchorsRef.current.set(event.feedId, {
        anchor,
        offsetWithinMessage: event.offsetWithinMessage,
      })
      void loadDemoFeedMessages(event.feedId).then((feedMessages) => {
        saveDemoViewportAnchor(
          event.feedId,
          toPersistedViewportAnchor(
            anchor,
            feedMessages,
            event.offsetWithinMessage ?? 0,
          ),
        )
      })
    }
  }, [runtimeCache])
  const selectFeed = useCallback((feedId: string) => {
    if (feedId !== activeFeedId) {
      stopLongRunningMocks()
      resetSessionLoadingOverlay()
      setFeedLoading(true)
      setEdgeLoading('before', false)
      setEdgeLoading('after', false)
    }
    activeFeedIdRef.current = feedId
    setActiveFeedId(feedId)
  }, [activeFeedId, resetSessionLoadingOverlay, setEdgeLoading, stopLongRunningMocks])
  const resetE2EScenario = useCallback(async (scenarioId: string) => {
    stopLongRunningMocks()
    bootstrapTokenRef.current += 1
    savedAnchorsRef.current.clear()
    setEdgeLoading('before', false)
    setEdgeLoading('after', false)
    deferredEdgeResponseDelayMsRef.current = 0
    deferredSessionResponseDelayMsRef.current = 0
    resetMessageMutationState()
    resetOptimisticRemap()
    const prepared = prepareDemoE2EScenario({
      scenarioId,
      pageSize: PAGE_SIZE,
      getDataRuntime,
      runtimeCache,
    })
    activeFeedIdRef.current = prepared.feedId
    setActiveFeedId(prepared.feedId)
    setMessages(prepared.messages)
    setMessageCount(prepared.messageCount)
    setFeedLoading(false)
    setLastEvent(`reset ${scenarioId}`)
    prepared.runtime.applyLoadedSegment(prepared.segment)
    await Promise.resolve()
    if (prepared.shouldScrollToLatest) {
      prepared.runtime.scrollToLatest()
    }
  }, [
    getDataRuntime,
    resetMessageMutationState,
    resetOptimisticRemap,
    runtimeCache,
    setEdgeLoading,
    stopLongRunningMocks,
  ])
  useEffect(() => () => {
    stopLongRunningMocks()
    clearHighlightTimer(highlightTimerRef)
  }, [stopLongRunningMocks])
  const runtimeSnapshot = runtime.getSnapshot()
  return {
    feeds: DEMO_FEEDS,
    activeFeedId,
    selectedFeedId: activeFeedId,
    pendingFeedId: null,
    activeFeed,
    activeRuntime: runtime,
    messageCount,
    loadedMessageCount: messages.length,
    hasMoreBefore: runtimeSnapshot.segmentMeta.hasMoreBefore,
    hasMoreAfter: runtimeSnapshot.segmentMeta.hasMoreAfter,
    loadingBefore: loadingBefore ||
      runtimeSnapshot.edgeState.before.status === 'loading',
    loadingAfter: loadingAfter ||
      runtimeSnapshot.edgeState.after.status === 'loading',
    feedLoading,
    sessionLoadingOverlayVisible,
    eventStormRunning,
    botPushActive,
    highlightedMessageId,
    highlightToken,
    pendingOperation: feedLoading ? 'loading' : 'idle',
    lastEvent,
    selectFeed,
    loadHistoryBatch: () => loadEdgeBatch('before'),
    loadFutureBatch: () => loadEdgeBatch('after'),
    appendMessage,
    appendMessages,
    appendLongBurst,
    toggleEventStorm,
    toggleBotPush,
    editMessage,
    deleteMessage,
    reactToMessage,
    toggleDynamicHeight,
    sendMessage,
    retryFailedSend: () => false,
    followBottom,
    jumpToQuote,
    clearFeed,
    rememberRuntimeViewportAnchor,
    resetE2EScenario,
    streamCurrentRow,
    deferNextEdgeResponse,
    deferNextSessionResponse,
    sendOptimisticMessage,
    alignPendingOptimisticAtStart,
    resolveOptimisticRemap,
    sendOptimisticAndRemap,
  }
}
