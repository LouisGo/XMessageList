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
  createOutgoingMessage,
  getNextMessageSequence,
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
import {
  type AdvancedMockEventStormState,
  type AdvancedMockPublishResult,
  applyBotPushTick,
  applyEventStormTick,
  createEventStormState,
  flushEventStormBuffer,
  getNextBotPushDelayMs,
  getNextEventStormDelayMs,
} from './demoAdvancedMockScenarios'
import type { DemoFeedRuntimeCache } from './useDemoFeedRuntimeCache'

const PAGE_SIZE = 20
const LONG_BURST_SIZE = 4
const LONG_BURST_EXPANDED_INDEX = 1
const LONG_BURST_LINE_COUNT = 10
const JUMP_HIGHLIGHT_DURATION_MS = 1_400
const REACTION_EMOJIS = ['😀', '😂', '🔥', '👍', '🎉', '😭', '👀', '❤️', '🚀', '🥲']

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
  jumpToQuote: (input?: {
    origin: { messageId: string; position?: number }
    target: { messageId: string; position?: number }
  }) => void
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
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [highlightToken, setHighlightToken] = useState(0)
  const eventStormTimerRef = useRef<number | null>(null)
  const botPushTimerRef = useRef<number | null>(null)
  const eventStormStateRef = useRef<AdvancedMockEventStormState | null>(null)
  const eventStormTokenRef = useRef(0)
  const botPushTokenRef = useRef(0)
  const highlightTimerRef = useRef<number | null>(null)
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

  const updateMessage = useCallback((
    messageId: string,
    mutate: (message: DemoMessage) => DemoMessage | null,
    eventText: string,
  ) => {
    const dataRuntime = getDataRuntime(activeFeedId)
    const currentMessages = readLoadedMessages(dataRuntime)
    const feedMessages = readDemoFeedMessages(activeFeedId)
    let changed = false
    const nextFeedMessages = feedMessages.flatMap((message) => {
      if (message.id !== messageId) {
        return [message]
      }

      changed = true
      const nextMessage = mutate(message)
      return nextMessage ? [nextMessage] : []
    })

    if (!changed) {
      setLastEvent(`message ${messageId} not found`)
      return
    }

    const nextMessages = currentMessages.flatMap((message) => {
      if (message.id !== messageId) {
        return [message]
      }

      const nextMessage = mutate(message)
      return nextMessage ? [nextMessage] : []
    })

    replaceLoadedMessages({
      feedId: activeFeedId,
      feedMessages: nextFeedMessages,
      messages: nextMessages,
      changedKeys: [messageId],
      eventText,
    })
  }, [activeFeedId, getDataRuntime, replaceLoadedMessages])

  const toggleDynamicHeight = useCallback(() => {
    const dataRuntime = getDataRuntime(activeFeedId)
    const currentMessages = readLoadedMessages(dataRuntime)

    if (currentMessages.length === 0) {
      return
    }

    dynamicHeightExpandedRef.current = !dynamicHeightExpandedRef.current
    const target = currentMessages[Math.floor(currentMessages.length / 2)]

    if (!target) {
      return
    }

    updateMessage(
      target.id,
      (message) => ({
        ...message,
        expanded: dynamicHeightExpandedRef.current,
      }),
      dynamicHeightExpandedRef.current
        ? 'expanded dynamic row height'
        : 'collapsed dynamic row height',
    )
  }, [activeFeedId, getDataRuntime, updateMessage])

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
      editedAt: new Date().toISOString(),
    }
    updateMessage(streamed.id, () => streamed, 'streamed current row')
  }, [activeFeedId, getDataRuntime, runtime, updateMessage])

  const editMessage = useCallback((messageId: string, nextBody: string) => {
    const trimmed = nextBody.trim()

    if (!trimmed) {
      setLastEvent('edit skipped: empty body')
      return
    }

    updateMessage(
      messageId,
      (message) => ({
        ...message,
        body: trimmed,
        kind: trimmed.length > 180 ? 'longText' : message.kind,
        editedAt: new Date().toISOString(),
      }),
      `edited ${messageId}`,
    )
  }, [updateMessage])

  const deleteMessage = useCallback((messageId: string) => {
    updateMessage(messageId, () => null, `deleted ${messageId}`)
  }, [updateMessage])

  const reactToMessage = useCallback((messageId: string) => {
    updateMessage(
      messageId,
      (message) => ({
        ...message,
        reactions: [
          ...message.reactions,
          REACTION_EMOJIS[
            (message.reactions.length + message.sequence) % REACTION_EMOJIS.length
          ] ?? '👍',
        ],
      }),
      `reacted to ${messageId}`,
    )
  }, [updateMessage])

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
    const tailMessages = createMockNewestMessages({
      feedId: activeFeedId,
      count: 6,
      existingMessages: [...allMessages, committedMessage],
      startSequence: nextSequence + 1,
    })
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

  const stopEventStorm = useCallback((flushBuffered: boolean) => {
    if (eventStormTimerRef.current !== null) {
      window.clearTimeout(eventStormTimerRef.current)
      eventStormTimerRef.current = null
    }
    eventStormTokenRef.current += 1
    setEventStormRunning(false)

    if (!flushBuffered || !eventStormStateRef.current) {
      eventStormStateRef.current = null
      return
    }

    const dataRuntime = getDataRuntime(activeFeedId)
    const previousMessages = readLoadedMessages(dataRuntime)
    const result = flushEventStormBuffer({
      feedId: activeFeedId,
      feedMessages: readDemoFeedMessages(activeFeedId),
      messages: previousMessages,
      hasMoreAfter: dataRuntime.getSegment().hasMoreAfter,
      state: eventStormStateRef.current,
    })
    eventStormStateRef.current = null

    if (result) {
      applyAdvancedMockResult(activeFeedId, result, previousMessages)
      return
    }

    setLastEvent('event storm stopped')
  }, [activeFeedId, applyAdvancedMockResult, getDataRuntime])

  const stopBotPush = useCallback(() => {
    if (botPushTimerRef.current !== null) {
      window.clearTimeout(botPushTimerRef.current)
      botPushTimerRef.current = null
    }
    botPushTokenRef.current += 1
    setBotPushActive(false)
  }, [])

  const stopLongRunningMocks = useCallback(() => {
    stopEventStorm(false)
    stopBotPush()
  }, [stopBotPush, stopEventStorm])

  const scheduleEventStormTick = useCallback(function schedule(
    feedId: string,
    token: number,
  ) {
    eventStormTimerRef.current = window.setTimeout(() => {
      if (eventStormTokenRef.current !== token || !eventStormStateRef.current) {
        return
      }

      const dataRuntime = getDataRuntime(feedId)
      const previousMessages = readLoadedMessages(dataRuntime)
      const result = applyEventStormTick({
        feedId,
        feedMessages: readDemoFeedMessages(feedId),
        messages: previousMessages,
        hasMoreAfter: dataRuntime.getSegment().hasMoreAfter,
        state: eventStormStateRef.current,
      })

      if (result) {
        applyAdvancedMockResult(feedId, result, previousMessages)
      }

      schedule(feedId, token)
    }, getNextEventStormDelayMs())
  }, [applyAdvancedMockResult, getDataRuntime])

  const scheduleBotPushTick = useCallback(function schedule(
    feedId: string,
    token: number,
  ) {
    botPushTimerRef.current = window.setTimeout(() => {
      if (botPushTokenRef.current !== token) {
        return
      }

      const dataRuntime = getDataRuntime(feedId)
      const previousMessages = readLoadedMessages(dataRuntime)
      const result = applyBotPushTick({
        feedId,
        feedMessages: readDemoFeedMessages(feedId),
        messages: previousMessages,
        hasMoreAfter: dataRuntime.getSegment().hasMoreAfter,
      })

      applyAdvancedMockResult(feedId, result, previousMessages)
      schedule(feedId, token)
    }, getNextBotPushDelayMs())
  }, [applyAdvancedMockResult, getDataRuntime])

  const toggleEventStorm = useCallback(() => {
    if (eventStormTimerRef.current !== null) {
      stopEventStorm(true)
      return
    }

    const feedId = activeFeedId
    const dataRuntime = getDataRuntime(feedId)
    const token = eventStormTokenRef.current + 1
    eventStormTokenRef.current = token
    eventStormStateRef.current = createEventStormState(readDemoFeedMessages(feedId))
    setEventStormRunning(true)
    scheduleEventStormTick(feedId, token)
    setLastEvent('event storm started')
    if (dataRuntime.getSegment().items.length === 0) {
      setLastEvent('event storm started; waiting for loaded segment')
    }
  }, [activeFeedId, getDataRuntime, scheduleEventStormTick, stopEventStorm])

  const toggleBotPush = useCallback(() => {
    if (botPushTimerRef.current !== null) {
      stopBotPush()
      setLastEvent('bot push stopped')
      return
    }

    const feedId = activeFeedId
    const token = botPushTokenRef.current + 1
    botPushTokenRef.current = token
    setBotPushActive(true)
    scheduleBotPushTick(feedId, token)
    setLastEvent('bot push started')
  }, [activeFeedId, scheduleBotPushTick, stopBotPush])

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
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
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

function readLoadedMessages(
  dataRuntime: MessageListDataRuntime<DemoMessage>,
): DemoMessage[] {
  return dataRuntime.getSegment().items
    .map((item) => item.message)
    .filter((message): message is DemoMessage => Boolean(message))
}

function createMockNewestMessages(input: {
  feedId: string
  count: number
  existingMessages: DemoMessage[]
  startSequence?: number
}): DemoMessage[] {
  const firstSequence = input.startSequence ??
    getNextMessageSequence(input.existingMessages)
  let quoteCandidates = [...input.existingMessages]

  return Array.from({ length: input.count }, (_, index) => {
    const message = createNewestMessage({
      feedId: input.feedId,
      sequence: firstSequence + index,
      quoteCandidates,
    })
    quoteCandidates = [...quoteCandidates, message]
    return message
  })
}

function applyLongBurstShape(messages: DemoMessage[]): DemoMessage[] {
  return messages.map((message, index) =>
    index === LONG_BURST_EXPANDED_INDEX
      ? {
          ...message,
          kind: 'longText',
          body: expandBodyToLineCount(message.body, LONG_BURST_LINE_COUNT),
          expanded: true,
        }
      : message,
  )
}

function expandBodyToLineCount(body: string, lineCount: number): string {
  const sourceLines = body.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const lines = sourceLines.length > 0 ? sourceLines : [body]

  return Array.from({ length: lineCount }, (_, index) =>
    lines[index % lines.length] ?? '',
  ).join('\n')
}

function resolveLoadedBounds(
  feedMessages: DemoMessage[],
  messages: DemoMessage[],
): {
  hasMoreBefore?: boolean
  hasMoreAfter?: boolean
} {
  if (messages.length === 0) {
    return {
      hasMoreBefore: feedMessages.length > 0,
      hasMoreAfter: false,
    }
  }

  const firstIndex = feedMessages.findIndex((message) =>
    message.id === messages[0]?.id
  )
  const lastIndex = feedMessages.findIndex((message) =>
    message.id === messages.at(-1)?.id
  )

  return {
    hasMoreBefore: firstIndex > 0,
    hasMoreAfter: lastIndex >= 0 && lastIndex < feedMessages.length - 1,
  }
}

function resolveChangedMessageKeys(
  before: DemoMessage[],
  after: DemoMessage[],
): string[] {
  const beforeById = new Map(before.map((message) => [message.id, message]))
  const afterById = new Map(after.map((message) => [message.id, message]))
  const changed = new Set<string>()

  for (const message of before) {
    const next = afterById.get(message.id)

    if (!next || serializeComparableMessage(message) !== serializeComparableMessage(next)) {
      changed.add(message.id)
    }
  }

  for (const message of after) {
    if (!beforeById.has(message.id)) {
      changed.add(message.id)
    }
  }

  return [...changed]
}

function serializeComparableMessage(message: DemoMessage): string {
  return JSON.stringify({
    body: message.body,
    kind: message.kind,
    expanded: message.expanded,
    editedAt: message.editedAt ?? '',
    reactions: message.reactions,
    media: message.media ?? null,
    quote: message.quote ?? null,
  })
}

function highlightMessage(
  messageId: string,
  options: {
    setHighlightedMessageId: (messageId: string | null) => void
    setHighlightToken: (updater: (token: number) => number) => void
    highlightTimerRef: { current: number | null }
  },
): void {
  if (options.highlightTimerRef.current !== null) {
    window.clearTimeout(options.highlightTimerRef.current)
  }

  options.setHighlightedMessageId(messageId)
  options.setHighlightToken((token) => token + 1)
  options.highlightTimerRef.current = window.setTimeout(() => {
    options.setHighlightedMessageId(null)
    options.highlightTimerRef.current = null
  }, JUMP_HIGHLIGHT_DURATION_MS)
}
