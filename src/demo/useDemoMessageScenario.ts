import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MessageIdentityAnchor,
  MessageListRuntimeEvent,
  ViewportAnchorChangedEvent,
} from '../runtime'
import {
  createMessageListDataRuntime,
  type MessageListDataRuntime,
} from '../runtime/data'
import {
  createDemoMessages,
  createOutgoingMessage,
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
import type { AdvancedMockPublishResult } from './demoAdvancedMockScenarios'
import {
  applyLongBurstShape,
  clearHighlightTimer,
  consumeDeferredEdgeResponseDelay,
  createMockNewestMessages,
  highlightMessage,
  isRuntimeNeedEvent,
  readLoadedMessages,
  resolveChangedMessageKeys,
  resolveLoadedBounds,
  resolveScenarioTotalMessages,
  usesAroundBootstrap,
  wait,
} from './scenario/demoScenarioHelpers'
import {
  useDemoLongRunningMocks,
} from './scenario/useDemoLongRunningMocks'
import {
  useDemoMessageMutations,
} from './scenario/useDemoMessageMutations'
import {
  useDemoOptimisticRemap,
} from './scenario/useDemoOptimisticRemap'
import type { DemoMessageScenario } from './scenario/demoScenarioTypes'
import type { DemoFeedRuntimeCache } from './useDemoFeedRuntimeCache'

export type { DemoMessageScenario } from './scenario/demoScenarioTypes'

const PAGE_SIZE = 20
const LONG_BURST_SIZE = 4

export function useDemoMessageScenario(
  runtimeCache: DemoFeedRuntimeCache,
): DemoMessageScenario {
  const [activeFeedId, setActiveFeedId] = useState(DEMO_FEEDS[0].id)
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [lastEvent, setLastEvent] = useState('bootstrapping latest segment')
  const [feedLoading, setFeedLoading] = useState(true)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [highlightToken, setHighlightToken] = useState(0)
  const highlightTimerRef = useRef<number | null>(null)
  const dataRuntimesRef = useRef(new Map<string, MessageListDataRuntime<DemoMessage>>())
  const savedAnchorsRef = useRef(new Map<string, MessageIdentityAnchor>())
  const deferredEdgeResponseDelayMsRef = useRef(0)
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

  const replaceLoadedMessages = useCallback((input: {
    feedId: string
    feedMessages: DemoMessage[]
    messages: DemoMessage[]
    changedKeys: string[]
    eventText: string
  }) => {
    replaceDemoFeedMessages(input.feedId, input.feedMessages)

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

    setLastEvent(input.eventText)
  }, [getDataRuntime, publishSegment])

  const applyAdvancedMockResult = useCallback((
    feedId: string,
    result: AdvancedMockPublishResult,
    previousMessages: DemoMessage[],
  ) => {
    replaceLoadedMessages({
      feedId,
      feedMessages: result.feedMessages,
      messages: result.messages,
      changedKeys: resolveChangedMessageKeys(previousMessages, result.messages),
      eventText: result.eventText,
    })
  }, [replaceLoadedMessages])

  const appendGeneratedMessages = useCallback((
    feedId: string,
    count: number,
    options: { forceLongBurstRow?: boolean } = {},
  ): { messages: DemoMessage[]; visibleInCurrentWindow: boolean } => {
    const allMessages = readDemoFeedMessages(feedId)
    const dataRuntime = getDataRuntime(feedId)
    const visibleInCurrentWindow = !dataRuntime.getSegment().hasMoreAfter
    const generatedMessages = createMockNewestMessages({
      feedId,
      count,
      existingMessages: allMessages,
    })
    const nextMessages = options.forceLongBurstRow
      ? applyLongBurstShape(generatedMessages)
      : generatedMessages

    appendDemoFeedMessages(feedId, nextMessages)
    if (visibleInCurrentWindow) {
      publishActivePatch(feedId, nextMessages)
    }
    return { messages: nextMessages, visibleInCurrentWindow }
  }, [getDataRuntime, publishActivePatch])

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
    const result = appendGeneratedMessages(activeFeedId, 1)
    const message = result.messages[0]

    setLastEvent(
      result.visibleInCurrentWindow
        ? `appended ${message?.id ?? 'message'}`
        : `queued ${message?.id ?? 'message'} after current window`,
    )
  }, [activeFeedId, appendGeneratedMessages])

  const appendLongBurst = useCallback(() => {
    const result = appendGeneratedMessages(activeFeedId, LONG_BURST_SIZE, {
      forceLongBurstRow: true,
    })

    setLastEvent(
      result.visibleInCurrentWindow
        ? `appended long burst ${result.messages.length}`
        : `queued long burst ${result.messages.length} after current window`,
    )
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
    publishSegment,
    setLastEvent,
  })

  const deferNextEdgeResponse = useCallback((delayMs: number) => {
    deferredEdgeResponseDelayMsRef.current = Math.max(0, delayMs)
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

  const rememberRuntimeViewportAnchor = useCallback((
    event: ViewportAnchorChangedEvent,
  ) => {
    if (event.anchor) {
      savedAnchorsRef.current.set(event.feedId, event.anchor)
    }
  }, [])

  const selectFeed = useCallback((feedId: string) => {
    if (feedId !== activeFeedId) {
      stopLongRunningMocks()
      setFeedLoading(true)
    }
    setActiveFeedId(feedId)
  }, [activeFeedId, stopLongRunningMocks])

  const resetE2EScenario = useCallback(async (scenarioId: string) => {
    stopLongRunningMocks()
    savedAnchorsRef.current.clear()
    deferredEdgeResponseDelayMsRef.current = 0
    resetMessageMutationState()
    resetOptimisticRemap()

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
  }, [
    getDataRuntime,
    resetMessageMutationState,
    resetOptimisticRemap,
    runtimeCache,
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
    messageCount: messages.length,
    loadedMessageCount: messages.length,
    hasMoreBefore: runtimeSnapshot.segmentMeta.hasMoreBefore,
    hasMoreAfter: runtimeSnapshot.segmentMeta.hasMoreAfter,
    loadingBefore: runtimeSnapshot.edgeState.before.status === 'loading',
    loadingAfter: runtimeSnapshot.edgeState.after.status === 'loading',
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
    appendLongBurst,
    toggleEventStorm,
    toggleBotPush,
    editMessage,
    deleteMessage,
    reactToMessage,
    toggleDynamicHeight,
    sendMessage(body) {
      const trimmed = body.trim()

      if (!trimmed) {
        return false
      }
      const allMessages = readDemoFeedMessages(activeFeedId)
      const message = createOutgoingMessage(trimmed, {
        feedId: activeFeedId,
        sequence: (allMessages.at(-1)?.sequence ?? 0) + 1,
        quoteCandidates: allMessages,
      })
      appendDemoFeedMessages(activeFeedId, [message])
      publishActivePatch(activeFeedId, [message])
      setLastEvent(`sent ${message.id}`)
      return true
    },
    retryFailedSend: () => false,
    followBottom: () => runtime.scrollToLatest(),
    jumpToQuote: (input) => {
      const target = input?.target

      if (target) {
        runtime.scrollToMessage({
          feedId: activeFeedId,
          stableId: target.messageId,
          serverId: target.messageId,
        })
        highlightMessage(target.messageId, {
          setHighlightedMessageId,
          setHighlightToken,
          highlightTimerRef,
        })
        setLastEvent(`jump to quote ${target.messageId}`)
        return
      }

      const first = readLoadedMessages(getDataRuntime(activeFeedId))[0]
      if (!first) {
        setLastEvent('no loaded quote target')
        return
      }

      runtime.scrollToMessage({
        feedId: activeFeedId,
        stableId: first.id,
        serverId: first.id,
      })
      highlightMessage(first.id, {
        setHighlightedMessageId,
        setHighlightToken,
        highlightTimerRef,
      })
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
