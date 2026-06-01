import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type MessageListManager,
  type MessageListSession,
} from '../../index'
import type { DemoMessage } from '../data/demoData'
import { DEMO_FEEDS, getDemoFeedDefinition } from '../data/demoFeeds'
import {
  readDemoFeedMessages,
} from '../data/demoMessageApi'
import {
  clearHighlightTimer,
  wait,
} from './demoScenarioHelpers'
import {
  getDemoSessionLoadedMessages,
  getDemoSessionRuntime,
  getDemoSessionSnapshot,
} from './demoE2EHarnessInternals'
import {
  createDemoManager,
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
import { useDemoEdgeLoadingState } from './useDemoEdgeLoadingState'
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
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [messageCount, setMessageCount] = useState(0)
  const loadedMessagesRef = useRef<DemoMessage[]>([])
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
  const { loadingBefore, loadingAfter, setEdgeLoading } = useDemoEdgeLoadingState()

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
  const setLoadedMessages = useCallback((nextMessages: DemoMessage[]) => {
    loadedMessagesRef.current = nextMessages
    setMessages(nextMessages)
  }, [])
  const getLoadedMessages = useCallback(() => loadedMessagesRef.current, [])
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
  const [manager] = useState<MessageListManager<DemoMessage>>(() => {
    const managerBox: {
      current?: MessageListManager<DemoMessage>
    } = {}
    const managerInstance = createDemoManager({
      consumeDeferredEdgeResponseDelay,
      consumeDeferredSessionResponseDelay,
      canCompleteRequestActivation,
      getActiveFeedId,
      getSelectedFeedId,
      isFeedLoading,
      loadAnchor,
      saveAnchor,
      setEdgeLoading,
      setFeedLoading: setFeedLoadingState,
      setLastEvent,
      setMessageCount,
      setPendingFeedId,
      syncLoadedState: (feedId, eventText) => {
        syncLoadedStateFromManager({
          eventText,
          feedId,
          manager: managerBox.current as MessageListManager<DemoMessage>,
          activeFeedId: getActiveFeedId(),
          setLastEvent,
          setMessageCount,
          setMessages: setLoadedMessages,
        })
      },
    })

    managerBox.current = managerInstance
    return managerInstance
  })

  const getSession = useCallback((feedId: string): MessageListSession<DemoMessage> =>
    manager.getSession(feedId), [manager])
  const getHasMoreAfter = useCallback(() =>
    getDemoSessionSnapshot(
      getSession(managerStateRef.current.activeFeedId),
    ).segmentMeta.hasMoreAfter, [getSession, managerStateRef])
  const syncLoadedState = useCallback((feedId: string, eventText?: string) => {
    syncLoadedStateFromManager({
      eventText,
      feedId,
      manager,
      activeFeedId: managerStateRef.current.activeFeedId,
      setLastEvent,
      setMessageCount,
      setMessages: setLoadedMessages,
    })
  }, [manager, managerStateRef, setLoadedMessages])

  const activeSession = useMemo(
    () => manager.getSession(activeFeedId),
    [activeFeedId, manager],
  )
  const runtime = useMemo(
    () => getDemoSessionRuntime(activeSession),
    [activeSession],
  )
  const activeFeed = useMemo(() => getDemoFeedDefinition(activeFeedId), [activeFeedId])
  const runtimeSnapshot = runtime.getSnapshot()

  const {
    publishActiveAppend,
    replaceLoadedMessages,
    applyAdvancedMockResult,
  } = useDemoSegmentPublisher({
    appendRows: (feedId, rows, follow) => {
      getSession(feedId).incoming.append({
        rows,
        reason: 'demo-append',
        follow,
      })
      syncLoadedState(feedId)
    },
    replaceRows: (input) => {
      getSession(input.feedId).rows.replace(input)
      syncLoadedState(input.feedId)
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
    getLoadedMessages,
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
    setEdgeLoading('before', false)
    setEdgeLoading('after', false)
    if (
      feedId === RANDOM_CHAT_FEED_ID &&
      managerStateRef.current.deferredSessionResponseDelayMs === 0
    ) {
      managerStateRef.current.deferredSessionResponseDelayMs = resolveDemoSessionDelayMs(feedId)
    }

    const delayMs = managerStateRef.current.deferredSessionResponseDelayMs
    const warmSession = manager.hasSession(feedId)
      ? manager.getSession(feedId)
      : null
    const warmSnapshot = warmSession
      ? getDemoSessionSnapshot(warmSession)
      : null
    const activationToken = managerStateRef.current.activationToken + 1

    managerStateRef.current.activationToken = activationToken
    managerStateRef.current.activeFeedId = feedId
    setActiveFeedId(feedId)
    setPendingFeedId(delayMs > 0 ? feedId : null)
    setFeedLoadingState(true)
    setLoadedMessages([])
    setMessageCount(0)
    setLastEvent(`loading ${getDemoFeedDefinition(feedId).title}`)

    if (delayMs === 0 && warmSnapshot && warmSnapshot.items.length > 0) {
      setPendingFeedId(null)
      setFeedLoadingState(false)
      syncLoadedState(feedId, `loaded ${getDemoFeedDefinition(feedId).title}`)
      return
    }

    if (delayMs > 0 && warmSnapshot && warmSnapshot.items.length > 0) {
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
        syncLoadedState(feedId, `loaded ${getDemoFeedDefinition(feedId).title}`)
      })()
      return
    }

    manager.getSession(feedId)
  }, [
    manager,
    managerStateRef,
    setEdgeLoading,
    setFeedLoadingState,
    setLoadedMessages,
    stopLongRunningMocks,
    syncLoadedState,
  ])
  const resetE2EScenario = useCallback(async (scenarioId: string) => {
    stopLongRunningMocks()
    managerStateRef.current.activationToken += 1
    managerStateRef.current.delayedWarmActivation = null
    managerStateRef.current.savedAnchors.clear()
    setEdgeLoading('before', false)
    setEdgeLoading('after', false)
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
    setLoadedMessages(prepared.messages)
    setMessageCount(prepared.messageCount)
    setFeedLoadingState(false)
    setLastEvent(`reset ${scenarioId}`)
    await Promise.resolve()
    if (prepared.shouldScrollToLatest) {
      getDemoSessionRuntime(manager.getSession(prepared.feedId)).scrollToLatest()
    }
  }, [
    manager,
    managerStateRef,
    resetMessageMutationState,
    resetOptimisticRemap,
    setEdgeLoading,
    setFeedLoadingState,
    setLoadedMessages,
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
    activeSession,
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

function syncLoadedStateFromManager(input: {
  manager: MessageListManager<DemoMessage>
  feedId: string
  activeFeedId: string
  eventText?: string
  setMessages: (messages: DemoMessage[]) => void
  setMessageCount: (messageCount: number) => void
  setLastEvent: (eventText: string) => void
}): void {
  if (!input.manager.hasSession(input.feedId)) {
    return
  }

  const nextMessages = getDemoSessionLoadedMessages(
    input.manager.getSession(input.feedId),
  )

  if (input.activeFeedId !== input.feedId) {
    return
  }

  input.setMessages(nextMessages)
  input.setMessageCount(readDemoFeedMessages(input.feedId).length)
  if (input.eventText) {
    input.setLastEvent(input.eventText)
  }
}
