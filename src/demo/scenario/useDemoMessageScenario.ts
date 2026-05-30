import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ViewportAnchorChangedEvent,
} from '../../runtime/index'
import type { DemoMessage } from '../data/demoData'
import { DEMO_FEEDS, getDemoFeedDefinition } from '../data/demoFeeds'
import {
  loadDemoFeedMessages,
  saveDemoViewportAnchor,
} from '../data/demoMessageApi'
import { clearHighlightTimer } from './demoScenarioHelpers'
import {
  prepareDemoE2EScenario,
  selectDemoFeed,
  type SavedRuntimeAnchor,
  toPersistedViewportAnchor,
} from './demoScenarioRuntimeHelpers'
import {
  APPEND_DELAY_BASE_MS,
  EDGE_LOAD_DELAY_BASE_MS,
  LONG_BURST_DELAY_BASE_MS,
  LONG_BURST_SIZE,
  PAGE_SIZE,
  SEND_DELAY_BASE_MS,
  SESSION_LOADING_OVERLAY_DELAY_MS,
} from './demoScenarioConfig'
import { useDemoDataRuntimeRegistry } from './useDemoDataRuntimeRegistry'
import { useDemoEdgeBatchLoader } from './useDemoEdgeBatchLoader'
import { useDemoEdgeLoadingState } from './useDemoEdgeLoadingState'
import { useDemoFeedBootstrap } from './useDemoFeedBootstrap'
import { useDelayedVisibility } from './useDelayedVisibility'
import { useDemoGeneratedAppends } from './useDemoGeneratedAppends'
import { useDemoLongRunningMocks } from './useDemoLongRunningMocks'
import { useDemoMessageCommands } from './useDemoMessageCommands'
import { useDemoMessageMutations } from './useDemoMessageMutations'
import { useDemoOptimisticRemap } from './useDemoOptimisticRemap'
import { useDemoRuntimeEventBridge } from './useDemoRuntimeEventBridge'
import { useDemoSegmentPublisher } from './useDemoSegmentPublisher'
import type { DemoMessageScenario } from './demoScenarioTypes'
import type { DemoFeedRuntimeCache } from '../runtime/useDemoFeedRuntimeCache'
export type { DemoMessageScenario } from './demoScenarioTypes'

export function useDemoMessageScenario(
  runtimeCache: DemoFeedRuntimeCache,
): DemoMessageScenario {
  const [activeFeedId, setActiveFeedId] = useState(DEMO_FEEDS[0].id)
  const [selectedFeedId, setSelectedFeedId] = useState(DEMO_FEEDS[0].id)
  const [pendingFeedId, setPendingFeedId] = useState<string | null>(null)
  const activeFeedIdRef = useRef(activeFeedId)
  const selectedFeedIdRef = useRef(DEMO_FEEDS[0].id)
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [messageCount, setMessageCount] = useState(0)
  const [lastEvent, setLastEvent] = useState('bootstrapping latest segment')
  const [feedLoading, setFeedLoading] = useState(true)
  const feedLoadingRef = useRef(true)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [highlightToken, setHighlightToken] = useState(0)
  const highlightTimerRef = useRef<number | null>(null)
  const savedAnchorsRef = useRef(new Map<string, SavedRuntimeAnchor>())
  const deferredEdgeResponseDelayMsRef = useRef(0)
  const deferredSessionResponseDelayMsRef = useRef(0)
  const bootstrapTokenRef = useRef(0)
  const { loadingBefore, loadingAfter, setEdgeLoading } = useDemoEdgeLoadingState()
  const [sessionLoadingOverlayVisible, resetSessionLoadingOverlay] = useDelayedVisibility(feedLoading, SESSION_LOADING_OVERLAY_DELAY_MS)
  const runtime = runtimeCache.getRuntime(activeFeedId)
  const activeFeed = useMemo(() => getDemoFeedDefinition(activeFeedId), [activeFeedId])
  useEffect(() => {
    activeFeedIdRef.current = activeFeedId
  }, [activeFeedId])
  useEffect(() => {
    selectedFeedIdRef.current = selectedFeedId
  }, [selectedFeedId])
  const isActiveFeed = useCallback((feedId: string) =>
    activeFeedIdRef.current === feedId, [])
  const setFeedLoadingState = useCallback((loading: boolean) => {
    feedLoadingRef.current = loading
    setFeedLoading(loading)
  }, [])
  const { getDataRuntime } = useDemoDataRuntimeRegistry()
  const {
    publishSegment,
    publishActivePatch,
    replaceLoadedMessages,
    applyAdvancedMockResult,
  } = useDemoSegmentPublisher({
    runtimeCache,
    getDataRuntime,
    isActiveFeed,
    setMessages,
    setMessageCount,
    setLastEvent,
  })
  const ensureRuntimeEventSubscription = useDemoRuntimeEventBridge({
    runtimeCache,
    getDataRuntime,
    publishSegment,
    selectedFeedIdRef,
    feedLoadingRef,
    deferredEdgeResponseDelayMsRef,
    setEdgeLoading,
    setMessageCount,
    setLastEvent,
  })
  useEffect(() => {
    ensureRuntimeEventSubscription(activeFeedId)
  }, [activeFeedId, ensureRuntimeEventSubscription])
  useDemoFeedBootstrap({
    activeFeedId,
    pendingFeedId,
    pageSize: PAGE_SIZE,
    runtimeCache,
    getDataRuntime,
    publishSegment,
    bootstrapTokenRef,
    deferredSessionResponseDelayMsRef,
    savedAnchorsRef,
    activeFeedIdRef,
    setActiveFeedId,
    setPendingFeedId,
    setMessages,
    setMessageCount,
    setFeedLoading: setFeedLoadingState,
    setLastEvent,
  })
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
    selectedFeedIdRef.current = feedId
    ensureRuntimeEventSubscription(feedId)
    selectDemoFeed({
      feedId,
      activeFeedId,
      selectedFeedId,
      activeFeedIdRef,
      savedAnchorsRef,
      deferredSessionResponseDelayMsRef,
      pageSize: PAGE_SIZE,
      runtimeCache,
      getDataRuntime,
      publishSegment,
      stopLongRunningMocks,
      resetSessionLoadingOverlay,
      setEdgeLoading,
      setActiveFeedId,
      setSelectedFeedId,
      setPendingFeedId,
      setFeedLoading: setFeedLoadingState,
      setMessages,
      setMessageCount,
      setLastEvent,
    })
  }, [
    activeFeedId,
    ensureRuntimeEventSubscription,
    getDataRuntime,
    publishSegment,
    resetSessionLoadingOverlay,
    runtimeCache,
    selectedFeedId,
    setEdgeLoading,
    setFeedLoadingState,
    stopLongRunningMocks,
  ])
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
    selectedFeedIdRef.current = prepared.feedId
    ensureRuntimeEventSubscription(prepared.feedId)
    setActiveFeedId(prepared.feedId)
    setSelectedFeedId(prepared.feedId)
    setPendingFeedId(null)
    setMessages(prepared.messages)
    setMessageCount(prepared.messageCount)
    setFeedLoadingState(false)
    setLastEvent(`reset ${scenarioId}`)
    prepared.runtime.applyLoadedSegment(prepared.segment)
    await Promise.resolve()
    if (prepared.shouldScrollToLatest) {
      prepared.runtime.scrollToLatest()
    }
  }, [
    ensureRuntimeEventSubscription,
    getDataRuntime,
    resetMessageMutationState,
    resetOptimisticRemap,
    runtimeCache,
    setEdgeLoading,
    setFeedLoadingState,
    stopLongRunningMocks,
  ])
  useEffect(() => () => {
    stopLongRunningMocks()
    clearHighlightTimer(highlightTimerRef)
  }, [stopLongRunningMocks])
  const runtimeSnapshot = runtime.getSnapshot()
  const canExposeEdgeLoading = !feedLoading
  const runtimeBeforeLoading = runtimeSnapshot.pendingIntent === 'edge-before' &&
    runtimeSnapshot.edgeState.before.status === 'loading'
  const runtimeAfterLoading = runtimeSnapshot.pendingIntent === 'edge-after' &&
    runtimeSnapshot.edgeState.after.status === 'loading'
  return {
    feeds: DEMO_FEEDS,
    activeFeedId,
    selectedFeedId,
    pendingFeedId,
    activeFeed,
    activeRuntime: runtime,
    messageCount,
    loadedMessageCount: messages.length,
    hasMoreBefore: runtimeSnapshot.segmentMeta.hasMoreBefore,
    hasMoreAfter: runtimeSnapshot.segmentMeta.hasMoreAfter,
    loadingBefore: canExposeEdgeLoading &&
      (loadingBefore || runtimeBeforeLoading),
    loadingAfter: canExposeEdgeLoading &&
      (loadingAfter || runtimeAfterLoading),
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
