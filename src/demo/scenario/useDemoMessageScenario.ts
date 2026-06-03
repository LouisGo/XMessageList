import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type MessageListRequestResult,
  type MessageListSession,
  type MessageListSessionRegistry,
  useMessageListState,
} from '../../index'
import type { DemoMessage } from '../data/demoData'
import { DEMO_FEEDS, getDemoFeedDefinition } from '../data/demoFeeds'
import {
  readDemoFeedMessages,
} from '../data/demoMessageApi'
import {
  clearHighlightTimer,
  resolveLoadedBounds,
  wait,
} from './demoScenarioHelpers'
import {
  createDemoManager,
  type DemoFeed,
  prepareDemoE2EScenario,
} from './demoMessageListManager'
import {
  RANDOM_CHAT_FEED_ID,
  resolveDemoSessionDelayMs,
  type SavedRuntimeAnchor,
} from './demoScenarioRuntimeHelpers'
import {
  APPEND_DELAY_BASE_MS,
  LONG_BURST_DELAY_BASE_MS,
  LONG_BURST_SIZE,
  PAGE_SIZE,
  SEND_DELAY_BASE_MS,
} from './demoScenarioConfig'
import { useDemoEdgeBatchLoader } from './useDemoEdgeBatchLoader'
import { useDemoGeneratedAppends } from './useDemoGeneratedAppends'
import { useDemoLongRunningMocks } from './useDemoLongRunningMocks'
import { useDemoMessageCommands } from './useDemoMessageCommands'
import { useDemoMessageMutations } from './useDemoMessageMutations'
import { useDemoOptimisticRemap } from './useDemoOptimisticRemap'
import { useDemoSegmentPublisher } from './useDemoSegmentPublisher'
import type { DemoMessageScenario } from './demoScenarioTypes'
export type { DemoMessageScenario } from './demoScenarioTypes'

export function useDemoMessageScenario(): DemoMessageScenario {
  const [activeFeedId, setActiveFeedId] = useState(DEMO_FEEDS[0].id)
  const [selectedFeedId, setSelectedFeedId] = useState(DEMO_FEEDS[0].id)
  const [pendingFeedId, setPendingFeedId] = useState<string | null>(null)
  const [messageCount, setMessageCount] = useState(0)
  const [lastEvent, setLastEvent] = useState('bootstrapping latest segment')
  const [feedLoading, setFeedLoading] = useState(true)
  const managerStateRef = useRef({
    activeFeedId: DEMO_FEEDS[0].id,
    selectedFeedId: DEMO_FEEDS[0].id,
    feedLoading: true,
    savedAnchors: new Map<string, SavedRuntimeAnchor>(),
    deferredEdgeResponseDelayMs: 0,
    deferredSessionResponseDelayMs: 0,
    activationToken: 0,
    delayedWarmActivation: null as {
      feedId: string
      token: number
    } | null,
  })
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [highlightToken, setHighlightToken] = useState(0)
  const highlightTimerRef = useRef<number | null>(null)
  const destroyManagerTimerRef = useRef<number | null>(null)

  useEffect(() => {
    managerStateRef.current.activeFeedId = activeFeedId
  }, [activeFeedId, managerStateRef])
  useEffect(() => {
    managerStateRef.current.selectedFeedId = selectedFeedId
  }, [managerStateRef, selectedFeedId])

  const isActiveFeed = useCallback((feedId: string) =>
    managerStateRef.current.activeFeedId === feedId, [managerStateRef])
  const setFeedLoadingState = useCallback((loading: boolean) => {
    managerStateRef.current.feedLoading = loading
    setFeedLoading(loading)
  }, [managerStateRef])
  const getActiveFeedId = useCallback(() => managerStateRef.current.activeFeedId, [managerStateRef])
  const getSelectedFeedId = useCallback(() => managerStateRef.current.selectedFeedId, [managerStateRef])
  const isFeedLoading = useCallback(() => managerStateRef.current.feedLoading, [managerStateRef])
  const syncLoadedStateFromRequest = useCallback((
    result: MessageListRequestResult<DemoMessage, unknown>,
    eventText?: string,
  ) => {
    if (result.status !== 'applied' || !result.page) {
      return
    }

    if (managerStateRef.current.activeFeedId !== result.id) {
      return
    }

    setMessageCount(result.page.total ?? readDemoFeedMessages(result.id).length)
    if (eventText) {
      setLastEvent(eventText)
    }
  }, [
    managerStateRef,
  ])
  const canCompleteRequestActivation = useCallback((feedId: string) => {
    const delayedWarmActivation = managerStateRef.current.delayedWarmActivation

    return !delayedWarmActivation || delayedWarmActivation.feedId !== feedId
  }, [managerStateRef])
  const consumeDeferredEdgeResponseDelay = useCallback(() => {
    const delayMs = managerStateRef.current.deferredEdgeResponseDelayMs
    managerStateRef.current.deferredEdgeResponseDelayMs = 0
    return delayMs
  }, [managerStateRef])
  const consumeDeferredSessionResponseDelay = useCallback(() => {
    const delayMs = managerStateRef.current.deferredSessionResponseDelayMs
    managerStateRef.current.deferredSessionResponseDelayMs = 0
    return delayMs
  }, [managerStateRef])
  const loadAnchor = useCallback((feedId: string) =>
    managerStateRef.current.savedAnchors.get(feedId) ?? null, [managerStateRef])
  const saveAnchor = useCallback((feedId: string, value: SavedRuntimeAnchor) => {
    managerStateRef.current.savedAnchors.set(feedId, value)
  }, [managerStateRef])

  // eslint-disable-next-line react-hooks/refs -- lazy manager construction stores callbacks; it does not read ref values during render.
  const [manager] = useState<MessageListSessionRegistry<DemoMessage, DemoFeed>>(() => {
    const managerInstance = createDemoManager({
      consumeDeferredEdgeResponseDelay,
      consumeDeferredSessionResponseDelay,
      canCompleteRequestActivation,
      getActiveFeedId,
      getSelectedFeedId,
      isFeedLoading,
      loadAnchor,
      saveAnchor,
      setFeedLoading: setFeedLoadingState,
      setLastEvent,
      setMessageCount,
      setPendingFeedId,
      syncLoadedState: syncLoadedStateFromRequest,
    })

    return managerInstance
  })

  const getSession = useCallback((feedId: string): MessageListSession<DemoMessage> =>
    manager.getSession(feedId), [manager])

  const activeSession = useMemo(
    () => manager.getSession(activeFeedId),
    [activeFeedId, manager],
  )
  const activeSessionState = useMessageListState(activeSession)
  const activeLoadedMessages = activeSessionState.loaded.rows
  const activeFeed = useMemo(() => getDemoFeedDefinition(activeFeedId), [activeFeedId])
  const getLoadedMessagesForFeed = useCallback((feedId: string) =>
    manager.getSession(feedId).getState().loaded.rows, [manager])
  const getLoadedMessages = useCallback(() =>
    manager.getSession(managerStateRef.current.activeFeedId)
      .getState().loaded.rows, [
    manager,
    managerStateRef,
  ])
  const getLoadedWindowBounds = useCallback((feedId: string) =>
    resolveLoadedBounds(
      readDemoFeedMessages(feedId),
      getLoadedMessagesForFeed(feedId),
    ), [getLoadedMessagesForFeed])
  const getHasMoreAfter = useCallback(() =>
    getLoadedWindowBounds(managerStateRef.current.activeFeedId).hasMoreAfter ?? false, [
    getLoadedWindowBounds,
    managerStateRef,
  ])
  const loadedWindowBounds = useMemo(() =>
    resolveLoadedBounds(readDemoFeedMessages(activeFeedId), activeLoadedMessages), [
    activeFeedId,
    activeLoadedMessages,
  ])

  const {
    publishActiveAppend,
    applyAdvancedMockResult,
  } = useDemoSegmentPublisher({
    appendRows: (feedId, rows, follow) => {
      getSession(feedId).tail.remote.append({
        rows,
        reason: 'demo-append',
        follow,
      })
    },
    replaceRows: (input) => {
      getSession(input.feedId).rows.replace(input)
    },
    isActiveFeed,
    setMessageCount,
    setLastEvent,
  })

  const {
    appendMessage,
    appendMessages,
    appendLongBurst,
  } = useDemoGeneratedAppends({
    activeFeedId,
    appendDelayBaseMs: APPEND_DELAY_BASE_MS,
    getHasMoreAfter,
    isActiveFeed,
    longBurstDelayBaseMs: LONG_BURST_DELAY_BASE_MS,
    longBurstSize: LONG_BURST_SIZE,
    publishActiveAppend,
    setLastEvent,
    setMessageCount,
  })
  const loadEdgeBatch = useDemoEdgeBatchLoader({
    activeFeedId,
    getSession,
    setLastEvent,
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
    session: activeSession,
    getLoadedMessages,
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
    session: activeSession,
    isActiveFeed,
    setLastEvent,
    onMessageCountChange: setMessageCount,
  })
  const deferNextEdgeResponse = useCallback((delayMs: number) => {
    managerStateRef.current.deferredEdgeResponseDelayMs = Math.max(0, delayMs)
  }, [managerStateRef])
  const deferNextSessionResponse = useCallback((delayMs: number) => {
    managerStateRef.current.deferredSessionResponseDelayMs = Math.max(0, delayMs)
  }, [managerStateRef])
  const {
    eventStormRunning,
    botPushActive,
    stopLongRunningMocks,
    toggleEventStorm,
    toggleBotPush,
  } = useDemoLongRunningMocks({
    activeFeedId,
    getHasMoreAfter,
    getLoadedMessages,
    applyAdvancedMockResult,
    setLastEvent,
  })
  const stopLongRunningMocksRef = useRef(stopLongRunningMocks)

  useEffect(() => {
    stopLongRunningMocksRef.current = stopLongRunningMocks
  }, [stopLongRunningMocks])

  useEffect(() => {
    if (destroyManagerTimerRef.current !== null) {
      window.clearTimeout(destroyManagerTimerRef.current)
      destroyManagerTimerRef.current = null
    }
  })
  const {
    sendMessage,
    retryFailedSend,
    followBottom,
    jumpToQuote,
    clearFeed,
  } = useDemoMessageCommands({
    activeFeedId,
    session: activeSession,
    getSession,
    getHasMoreAfter,
    getLoadedMessages,
    isActiveFeed,
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
  const selectFeed = useCallback((feedId: string) => {
    if (feedId === managerStateRef.current.selectedFeedId) {
      return
    }

    stopLongRunningMocks()
    managerStateRef.current.delayedWarmActivation = null
    managerStateRef.current.selectedFeedId = feedId
    setSelectedFeedId(feedId)
    if (
      feedId === RANDOM_CHAT_FEED_ID &&
      managerStateRef.current.deferredSessionResponseDelayMs === 0
    ) {
      managerStateRef.current.deferredSessionResponseDelayMs = resolveDemoSessionDelayMs(feedId)
    }

    const delayMs = managerStateRef.current.deferredSessionResponseDelayMs
    const activationToken = managerStateRef.current.activationToken + 1

    managerStateRef.current.activationToken = activationToken
    managerStateRef.current.activeFeedId = feedId
    setActiveFeedId(feedId)
    setPendingFeedId(delayMs > 0 ? feedId : null)
    setFeedLoadingState(true)
    setMessageCount(0)
    setLastEvent(`loading ${getDemoFeedDefinition(feedId).title}`)

    if (delayMs === 0 && manager.hasSession(feedId)) {
      setPendingFeedId(null)
      setFeedLoadingState(false)
      setMessageCount(readDemoFeedMessages(feedId).length)
      setLastEvent(`loaded ${getDemoFeedDefinition(feedId).title}`)
      return
    }

    if (delayMs > 0 && manager.hasSession(feedId)) {
      managerStateRef.current.deferredSessionResponseDelayMs = 0
      managerStateRef.current.delayedWarmActivation = {
        feedId,
        token: activationToken,
      }
      void (async () => {
        await wait(delayMs)
        if (
          managerStateRef.current.activationToken !== activationToken ||
          managerStateRef.current.activeFeedId !== feedId
        ) {
          return
        }

        managerStateRef.current.delayedWarmActivation = null
        setPendingFeedId(null)
        setFeedLoadingState(false)
        setMessageCount(readDemoFeedMessages(feedId).length)
        setLastEvent(`loaded ${getDemoFeedDefinition(feedId).title}`)
      })()
      return
    }

    manager.getSession(feedId)
  }, [
    manager,
    managerStateRef,
    setFeedLoadingState,
    stopLongRunningMocks,
  ])
  const resetE2EScenario = useCallback(async (scenarioId: string) => {
    stopLongRunningMocks()
    managerStateRef.current.activationToken += 1
    managerStateRef.current.delayedWarmActivation = null
    managerStateRef.current.savedAnchors.clear()
    managerStateRef.current.deferredEdgeResponseDelayMs = 0
    managerStateRef.current.deferredSessionResponseDelayMs = 0
    resetMessageMutationState()
    resetOptimisticRemap()

    const feedId = DEMO_FEEDS[0].id
    for (const sessionId of manager.getSessionIds()) {
      if (sessionId !== feedId) {
        manager.destroySession(sessionId)
      }
    }
    const prepared = await prepareDemoE2EScenario({
      scenarioId,
      feedId,
      pageSize: PAGE_SIZE,
      session: manager.getSession(feedId),
    })

    managerStateRef.current.activeFeedId = prepared.feedId
    managerStateRef.current.selectedFeedId = prepared.feedId
    setActiveFeedId(prepared.feedId)
    setSelectedFeedId(prepared.feedId)
    setPendingFeedId(null)
    setMessageCount(prepared.messageCount)
    setFeedLoadingState(false)
    setLastEvent(`reset ${scenarioId}`)
    await Promise.resolve()
    if (prepared.shouldScrollToLatest) {
      manager.getSession(prepared.feedId).commands.scrollToLatest()
    }
  }, [
    manager,
    managerStateRef,
    resetMessageMutationState,
    resetOptimisticRemap,
    setFeedLoadingState,
    stopLongRunningMocks,
  ])
  useEffect(() => () => {
    destroyManagerTimerRef.current = window.setTimeout(() => {
      stopLongRunningMocksRef.current()
      manager.destroyAll()
      clearHighlightTimer(highlightTimerRef)
      destroyManagerTimerRef.current = null
    }, 0)
  }, [manager])

  const canExposeEdgeLoading = !feedLoading &&
    activeSessionState.viewport.pendingIntent !== 'underflow-fill'

  return {
    feeds: DEMO_FEEDS,
    activeFeedId,
    selectedFeedId,
    pendingFeedId,
    activeFeed,
    activeSession,
    messageCount,
    loadedMessageCount: activeLoadedMessages.length,
    hasMoreBefore: loadedWindowBounds.hasMoreBefore ?? false,
    hasMoreAfter: loadedWindowBounds.hasMoreAfter ?? false,
    loadingBefore: canExposeEdgeLoading &&
      activeSessionState.edge.before.status === 'loading',
    loadingAfter: canExposeEdgeLoading &&
      activeSessionState.edge.after.status === 'loading',
    feedLoading,
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
    retryFailedSend,
    followBottom,
    jumpToQuote,
    clearFeed,
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
