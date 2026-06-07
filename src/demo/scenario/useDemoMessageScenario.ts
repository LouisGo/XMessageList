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
  saveDemoViewportAnchor,
} from '../data/demoMessageApi'
import {
  createDemoRequestId,
  writeDemoLog,
} from '../data/demoLocalStoreClient'
import {
  clearHighlightTimer,
  resolveLoadedBounds,
  wait,
} from './demoScenarioHelpers'
import {
  createDemoRegistry,
  type DemoFeed,
  prepareDemoE2EScenario,
} from './demoMessageListRegistry'
import { logDemoRuntimeEvent } from './demoProfilingLog'
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
  const registryStateRef = useRef({
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
  const destroyRegistryTimerRef = useRef<number | null>(null)

  useEffect(() => {
    registryStateRef.current.activeFeedId = activeFeedId
  }, [activeFeedId, registryStateRef])
  useEffect(() => {
    registryStateRef.current.selectedFeedId = selectedFeedId
  }, [registryStateRef, selectedFeedId])

  const isActiveFeed = useCallback((feedId: string) =>
    registryStateRef.current.activeFeedId === feedId, [registryStateRef])
  const setFeedLoadingState = useCallback((loading: boolean) => {
    registryStateRef.current.feedLoading = loading
    setFeedLoading(loading)
  }, [registryStateRef])
  const getActiveFeedId = useCallback(() => registryStateRef.current.activeFeedId, [registryStateRef])
  const getSelectedFeedId = useCallback(() => registryStateRef.current.selectedFeedId, [registryStateRef])
  const isFeedLoading = useCallback(() => registryStateRef.current.feedLoading, [registryStateRef])
  const syncLoadedStateFromRequest = useCallback((
    result: MessageListRequestResult<DemoMessage, unknown>,
    eventText?: string,
  ) => {
    if (result.status !== 'applied' || !result.page) {
      return
    }

    if (registryStateRef.current.activeFeedId !== result.sessionId) {
      return
    }

    void writeDemoLog({
      requestId: createDemoRequestId('feed.load'),
      operation: 'feed.load',
      phase: 'success',
      feedId: result.sessionId,
      messageCount: result.page.rows.length,
      details: {
        kind: result.kind,
        status: result.status,
        total: result.page.total,
        hasMoreBefore: result.page.hasMoreBefore,
        hasMoreAfter: result.page.hasMoreAfter,
        anchorId: result.page.anchor?.id,
        anchorStatus: result.page.anchorStatus,
        firstMessageId: result.page.rows[0]?.id,
        lastMessageId: result.page.rows.at(-1)?.id,
      },
    })
    setMessageCount(result.page.total ?? readDemoFeedMessages(result.sessionId).length)
    if (eventText) {
      setLastEvent(eventText)
    }
  }, [
    registryStateRef,
  ])
  const canCompleteRequestActivation = useCallback((feedId: string) => {
    const delayedWarmActivation = registryStateRef.current.delayedWarmActivation

    return !delayedWarmActivation || delayedWarmActivation.feedId !== feedId
  }, [registryStateRef])
  const consumeDeferredEdgeResponseDelay = useCallback(() => {
    const delayMs = registryStateRef.current.deferredEdgeResponseDelayMs
    registryStateRef.current.deferredEdgeResponseDelayMs = 0
    return delayMs
  }, [registryStateRef])
  const consumeDeferredSessionResponseDelay = useCallback(() => {
    const delayMs = registryStateRef.current.deferredSessionResponseDelayMs
    registryStateRef.current.deferredSessionResponseDelayMs = 0
    return delayMs
  }, [registryStateRef])
  const loadAnchor = useCallback((feedId: string) =>
    registryStateRef.current.savedAnchors.get(feedId) ?? null, [registryStateRef])
  const saveAnchor = useCallback((feedId: string, value: SavedRuntimeAnchor) => {
    registryStateRef.current.savedAnchors.set(feedId, value)
  }, [registryStateRef])
  const invalidateAnchorMemory = useCallback((feedId: string) => {
    registryStateRef.current.savedAnchors.delete(feedId)
    saveDemoViewportAnchor(feedId, undefined)
  }, [registryStateRef])

  // eslint-disable-next-line react-hooks/refs -- lazy registry construction stores callbacks; it does not read ref values during render.
  const [registry] = useState<MessageListSessionRegistry<DemoMessage, DemoFeed>>(() => {
    const registryInstance = createDemoRegistry({
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
      onRuntimeEvent: (event) =>
        logDemoRuntimeEvent(event, registryStateRef.current.activeFeedId),
    })

    return registryInstance
  })

  const getSession = useCallback((feedId: string): MessageListSession<DemoMessage> =>
    registry.getSession(feedId), [registry])

  const activeSession = useMemo(
    () => registry.getSession(activeFeedId),
    [activeFeedId, registry],
  )
  const activeSessionState = useMessageListState(activeSession)
  const activeLoadedMessages = activeSessionState.loaded.rows
  const activeFeed = useMemo(() => getDemoFeedDefinition(activeFeedId), [activeFeedId])
  const getLoadedMessagesForFeed = useCallback((feedId: string) =>
    registry.getSession(feedId).getState().loaded.rows, [registry])
  const getLoadedMessages = useCallback(() =>
    registry.getSession(registryStateRef.current.activeFeedId)
      .getState().loaded.rows, [
    registry,
    registryStateRef,
  ])
  const getLoadedWindowBounds = useCallback((feedId: string) =>
    resolveLoadedBounds(
      readDemoFeedMessages(feedId),
      getLoadedMessagesForFeed(feedId),
    ), [getLoadedMessagesForFeed])
  const getHasMoreAfter = useCallback(() =>
    getLoadedWindowBounds(registryStateRef.current.activeFeedId).hasMoreAfter ?? false, [
    getLoadedWindowBounds,
    registryStateRef,
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
    pageSize: PAGE_SIZE,
    setLastEvent,
    onMessageCountChange: setMessageCount,
  })
  const deferNextEdgeResponse = useCallback((delayMs: number) => {
    registryStateRef.current.deferredEdgeResponseDelayMs = Math.max(0, delayMs)
  }, [registryStateRef])
  const deferNextSessionResponse = useCallback((delayMs: number) => {
    registryStateRef.current.deferredSessionResponseDelayMs = Math.max(0, delayMs)
  }, [registryStateRef])
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
    if (destroyRegistryTimerRef.current !== null) {
      window.clearTimeout(destroyRegistryTimerRef.current)
      destroyRegistryTimerRef.current = null
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
    hasSession: (feedId) => registry.hasSession(feedId),
    getHasMoreAfter,
    getLoadedMessages,
    invalidateAnchorMemory,
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
    const fromFeedId = registryStateRef.current.selectedFeedId
    const requestId = createDemoRequestId('feed.select')

    if (feedId === registryStateRef.current.selectedFeedId) {
      void writeDemoLog({
        requestId,
        operation: 'feed.select',
        phase: 'skip',
        feedId,
        details: {
          fromFeedId,
          toFeedId: feedId,
          reason: 'already-selected',
        },
      })
      return
    }

    stopLongRunningMocks()
    registryStateRef.current.delayedWarmActivation = null
    registryStateRef.current.selectedFeedId = feedId
    setSelectedFeedId(feedId)
    if (
      feedId === RANDOM_CHAT_FEED_ID &&
      registryStateRef.current.deferredSessionResponseDelayMs === 0
    ) {
      registryStateRef.current.deferredSessionResponseDelayMs = resolveDemoSessionDelayMs(feedId)
    }

    const delayMs = registryStateRef.current.deferredSessionResponseDelayMs
    const activationToken = registryStateRef.current.activationToken + 1
    const hasWarmSession = registry.hasSession(feedId)

    void writeDemoLog({
      requestId,
      operation: 'feed.select',
      phase: 'start',
      feedId,
      details: {
        fromFeedId,
        toFeedId: feedId,
        delayMs,
        hasWarmSession,
        activationToken,
      },
    })

    registryStateRef.current.activationToken = activationToken
    registryStateRef.current.activeFeedId = feedId
    setActiveFeedId(feedId)
    setPendingFeedId(delayMs > 0 ? feedId : null)
    setFeedLoadingState(true)
    setMessageCount(0)
    setLastEvent(`loading ${getDemoFeedDefinition(feedId).title}`)

    if (delayMs === 0 && hasWarmSession) {
      setPendingFeedId(null)
      setFeedLoadingState(false)
      setMessageCount(readDemoFeedMessages(feedId).length)
      setLastEvent(`loaded ${getDemoFeedDefinition(feedId).title}`)
      void writeDemoLog({
        requestId,
        operation: 'feed.select',
        phase: 'success',
        feedId,
        details: {
          fromFeedId,
          toFeedId: feedId,
          mode: 'warm-immediate',
          activationToken,
        },
      })
      return
    }

    if (delayMs > 0 && hasWarmSession) {
      registryStateRef.current.deferredSessionResponseDelayMs = 0
      registryStateRef.current.delayedWarmActivation = {
        feedId,
        token: activationToken,
      }
      void (async () => {
        await wait(delayMs)
        if (
          registryStateRef.current.activationToken !== activationToken ||
          registryStateRef.current.activeFeedId !== feedId
        ) {
          void writeDemoLog({
            requestId,
            operation: 'feed.select',
            phase: 'cancel',
            feedId,
            details: {
              fromFeedId,
              toFeedId: feedId,
              mode: 'warm-delayed',
              activationToken,
              currentActivationToken: registryStateRef.current.activationToken,
              currentActiveFeedId: registryStateRef.current.activeFeedId,
            },
          })
          return
        }

        registryStateRef.current.delayedWarmActivation = null
        setPendingFeedId(null)
        setFeedLoadingState(false)
        setMessageCount(readDemoFeedMessages(feedId).length)
        setLastEvent(`loaded ${getDemoFeedDefinition(feedId).title}`)
        void writeDemoLog({
          requestId,
          operation: 'feed.select',
          phase: 'success',
          feedId,
          details: {
            fromFeedId,
            toFeedId: feedId,
            mode: 'warm-delayed',
            delayMs,
            activationToken,
          },
        })
      })()
      return
    }

    registry.getSession(feedId)
  }, [
    registry,
    registryStateRef,
    setFeedLoadingState,
    stopLongRunningMocks,
  ])
  const resetE2EScenario = useCallback(async (scenarioId: string) => {
    stopLongRunningMocks()
    registryStateRef.current.activationToken += 1
    registryStateRef.current.delayedWarmActivation = null
    registryStateRef.current.savedAnchors.clear()
    registryStateRef.current.deferredEdgeResponseDelayMs = 0
    registryStateRef.current.deferredSessionResponseDelayMs = 0
    resetMessageMutationState()
    resetOptimisticRemap()

    const feedId = DEMO_FEEDS[0].id
    for (const sessionId of registry.getSessionIds()) {
      if (sessionId !== feedId) {
        registry.destroySession(sessionId)
      }
    }
    const prepared = await prepareDemoE2EScenario({
      scenarioId,
      feedId,
      pageSize: PAGE_SIZE,
      session: registry.getSession(feedId),
    })

    registryStateRef.current.activeFeedId = prepared.feedId
    registryStateRef.current.selectedFeedId = prepared.feedId
    setActiveFeedId(prepared.feedId)
    setSelectedFeedId(prepared.feedId)
    setPendingFeedId(null)
    setMessageCount(prepared.messageCount)
    setFeedLoadingState(false)
    setLastEvent(`reset ${scenarioId}`)
    await Promise.resolve()
    if (prepared.shouldScrollToLatest) {
      registry.getSession(prepared.feedId).commands.scrollToLatest()
    }
  }, [
    registry,
    registryStateRef,
    resetMessageMutationState,
    resetOptimisticRemap,
    setFeedLoadingState,
    stopLongRunningMocks,
  ])
  useEffect(() => () => {
    destroyRegistryTimerRef.current = window.setTimeout(() => {
      stopLongRunningMocksRef.current()
      registry.destroyAll()
      clearHighlightTimer(highlightTimerRef)
      destroyRegistryTimerRef.current = null
    }, 0)
  }, [registry])

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
