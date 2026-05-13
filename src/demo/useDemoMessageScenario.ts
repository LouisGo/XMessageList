import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  MessageDataSnapshot,
  MessageViewportRuntime,
  ViewportEffect,
} from '../runtime'
import {
  type DemoMessage,
  createDemoMessages,
  createDemoSnapshot,
  createNewestMessage,
  createOlderMessages,
  createOutgoingMessage,
  getFirstMessageSequence,
  getNextMessageSequence,
  normalizeDemoMessages,
} from './demoData'
import {
  DEMO_FEEDS,
  getDemoFeedDefinition,
  type DemoFeedDefinition,
} from './demoFeeds'
import {
  createDemoRequestId,
  type DemoLogEntry,
  type DemoOperationName,
  loadPersistedDemoFeed,
  savePersistedDemoFeed,
  writeDemoLog,
} from './demoLocalStoreClient'

const HISTORY_BATCH_SIZE = 20
const FEED_LOAD_DELAY_MS = 180

const OPERATION_DELAYS: Record<
  Extract<
    DemoOperationName,
    | 'history.prepend'
    | 'message.append'
    | 'message.longBurst'
    | 'message.resize'
    | 'message.send'
    | 'feed.clear'
  >,
  number
> = {
  'history.prepend': 300,
  'message.append': 100,
  'message.longBurst': 320,
  'message.resize': 240,
  'message.send': 60,
  'feed.clear': 220,
}

type DemoSnapshotKind = MessageDataSnapshot['change']['kind']

type LoggedOperationResult = {
  effect: ViewportEffect
  kind: DemoSnapshotKind
  eventText: string
  details?: Record<string, unknown>
}

type RunLoggedOperationInput = {
  operation: keyof typeof OPERATION_DELAYS
  startEvent: string
  details?: Record<string, unknown>
  apply: (feedId: string) => LoggedOperationResult
  onFinally?: () => void
}

export type DemoMessageScenario = {
  feeds: DemoFeedDefinition[]
  activeFeedId: string
  activeFeed: DemoFeedDefinition
  messageCount: number
  loadingBefore: boolean
  feedLoading: boolean
  pendingOperation: string
  lastEvent: string
  selectFeed: (feedId: string) => void
  loadHistoryBatch: (source?: 'manual' | 'auto') => void
  appendMessage: () => void
  appendLongBurst: () => void
  toggleDynamicHeight: () => void
  sendMessage: (body: string) => boolean
  followBottom: (source: 'sidebar' | 'floating') => void
  clearFeed: (feedId: string) => void
}

/**
 * Demo 场景 hook 负责模拟 IM 数据请求、feed 切换和本地持久化。
 * runtime 仍然只接收 MessageDataSnapshot 和 command，不知道 demo 的 mock 请求过程。
 */
export function useDemoMessageScenario(
  runtime: MessageViewportRuntime<DemoMessage>,
): DemoMessageScenario {
  const initialFeedId = DEMO_FEEDS[0]?.id ?? 'feed-runtime'
  const [activeFeedId, setActiveFeedId] = useState(initialFeedId)
  const [messageCount, setMessageCount] = useState(0)
  const [loadingBefore, setLoadingBefore] = useState(false)
  const [feedLoading, setFeedLoading] = useState(true)
  const [pendingOperation, setPendingOperation] = useState('idle')
  const [lastEvent, setLastEvent] = useState(
    `loading ${getDemoFeedDefinition(initialFeedId).title}...`,
  )

  const activeFeedIdRef = useRef(activeFeedId)
  const messagesRef = useRef<DemoMessage[]>([])
  const revisionRef = useRef(1)
  const generationRef = useRef(1)
  const hasMoreBeforeRef = useRef(false)
  const loadingBeforeRef = useRef(false)
  const feedLoadingRef = useRef(false)
  const loadTokenRef = useRef(0)
  const pendingOperationCountRef = useRef(0)

  const activeFeed = useMemo(
    () => getDemoFeedDefinition(activeFeedId),
    [activeFeedId],
  )

  useEffect(() => {
    activeFeedIdRef.current = activeFeedId
  }, [activeFeedId])

  const log = useCallback((entry: DemoLogEntry) => writeDemoLog(entry), [])

  const beginPendingOperation = useCallback((operation: string) => {
    pendingOperationCountRef.current += 1
    setPendingOperation(operation)
  }, [])

  const endPendingOperation = useCallback(() => {
    pendingOperationCountRef.current = Math.max(
      0,
      pendingOperationCountRef.current - 1,
    )

    if (pendingOperationCountRef.current === 0) {
      setPendingOperation('idle')
    }
  }, [])

  /**
   * 所有会改动消息数组的 demo 请求都通过这一层发布给 runtime。
   * revision 只表达数据快照版本，feed/generation 则用于切会话时隔离 runtime 生命周期。
   */
  const publishCurrentMessages = useCallback((
    effect: ViewportEffect,
    kind: DemoSnapshotKind,
  ) => {
    revisionRef.current += 1
    setMessageCount(messagesRef.current.length)
    runtime.setDataSnapshot(
      createDemoSnapshot({
        feedId: activeFeedIdRef.current,
        generation: generationRef.current,
        messages: messagesRef.current,
        revision: revisionRef.current,
        effect,
        kind,
        hasMoreBefore: hasMoreBeforeRef.current,
      }),
    )
  }, [runtime])

  const persistCurrentFeed = useCallback(async () => {
    await savePersistedDemoFeed({
      version: 1,
      feedId: activeFeedIdRef.current,
      revision: revisionRef.current,
      hasMoreBefore: hasMoreBeforeRef.current,
      messages: messagesRef.current,
      updatedAt: new Date().toISOString(),
    })
  }, [])

  const runLoggedOperation = useCallback(async (input: RunLoggedOperationInput) => {
    const feedId = activeFeedIdRef.current
    const requestId = createDemoRequestId(input.operation)

    if (feedLoadingRef.current) {
      await log({
        requestId,
        operation: input.operation,
        phase: 'skip',
        feedId,
        messageCount: messagesRef.current.length,
        details: { reason: 'feed-loading', ...input.details },
      })
      input.onFinally?.()
      return
    }

    beginPendingOperation(input.operation)
    setLastEvent(input.startEvent)

    await log({
      requestId,
      operation: input.operation,
      phase: 'start',
      feedId,
      messageCount: messagesRef.current.length,
      details: input.details,
    })

    try {
      await sleep(OPERATION_DELAYS[input.operation])

      if (activeFeedIdRef.current !== feedId) {
        await log({
          requestId,
          operation: input.operation,
          phase: 'cancel',
          feedId,
          messageCount: messagesRef.current.length,
          details: { reason: 'feed-switched' },
        })
        return
      }

      const result = input.apply(feedId)

      publishCurrentMessages(result.effect, result.kind)
      await persistCurrentFeed()
      setLastEvent(result.eventText)

      await log({
        requestId,
        operation: input.operation,
        phase: 'success',
        feedId,
        messageCount: messagesRef.current.length,
        details: result.details,
      })
    } catch (error) {
      const message = getErrorMessage(error)
      setLastEvent(`${input.operation} failed`)
      await log({
        requestId,
        operation: input.operation,
        phase: 'error',
        feedId,
        messageCount: messagesRef.current.length,
        error: message,
      })
    } finally {
      input.onFinally?.()
      endPendingOperation()
    }
  }, [
    beginPendingOperation,
    endPendingOperation,
    log,
    persistCurrentFeed,
    publishCurrentMessages,
  ])

  const loadHistoryBatch = useCallback((source: 'manual' | 'auto' = 'manual') => {
    if (!hasMoreBeforeRef.current) {
      void log({
        requestId: createDemoRequestId('history.prepend'),
        operation: 'history.prepend',
        phase: 'skip',
        feedId: activeFeedIdRef.current,
        messageCount: messagesRef.current.length,
        details: { reason: 'history-unavailable', source },
      })
      setLastEvent('no older messages')
      return
    }

    if (loadingBeforeRef.current) {
      void log({
        requestId: createDemoRequestId('history.prepend'),
        operation: 'history.prepend',
        phase: 'skip',
        feedId: activeFeedIdRef.current,
        messageCount: messagesRef.current.length,
        details: { reason: 'already-loading', source },
      })
      return
    }

    loadingBeforeRef.current = true
    setLoadingBefore(true)

    void runLoggedOperation({
      operation: 'history.prepend',
      startEvent: 'loading history...',
      details: { batchSize: HISTORY_BATCH_SIZE, source },
      apply: (feedId) => {
        const older = createOlderMessages(HISTORY_BATCH_SIZE, {
          feedId,
          beforeSequence: getFirstMessageSequence(messagesRef.current),
        })

        messagesRef.current = [...older, ...messagesRef.current]

        return {
          effect: 'prepend',
          kind: 'prepend',
          eventText: `loaded ${HISTORY_BATCH_SIZE} older messages`,
          details: {
            added: older.length,
            firstAddedId: older[0]?.id,
            lastAddedId: older.at(-1)?.id,
          },
        }
      },
      onFinally: () => {
        loadingBeforeRef.current = false
        setLoadingBefore(false)
      },
    })
  }, [log, runLoggedOperation])

  const appendMessage = useCallback(() => {
    void runLoggedOperation({
      operation: 'message.append',
      startEvent: 'appending mock message...',
      details: { source: 'button' },
      apply: (feedId) => {
        const message = createNewestMessage({
          feedId,
          sequence: getNextMessageSequence(messagesRef.current),
        })

        messagesRef.current = [...messagesRef.current, message]

        return {
          effect: 'append',
          kind: 'append',
          eventText: `appended ${message.id}`,
          details: { appendedId: message.id, kind: message.kind },
        }
      },
    })
  }, [runLoggedOperation])

  const appendLongBurst = useCallback(() => {
    void runLoggedOperation({
      operation: 'message.longBurst',
      startEvent: 'appending long burst...',
      details: { burstSize: 4 },
      apply: (feedId) => {
        const startSequence = getNextMessageSequence(messagesRef.current)
        const next = Array.from({ length: 4 }, (_, index) =>
          createNewestMessage({ feedId, sequence: startSequence + index }),
        ).map((message, index) =>
          index === 1
            ? {
                ...message,
                kind: 'longText' as const,
                body: `${message.body} ${message.body} ${message.body}`,
                expanded: true,
              }
            : message,
        )

        messagesRef.current = [...messagesRef.current, ...next]

        return {
          effect: 'append',
          kind: 'append',
          eventText: `appended long burst ${next.length}`,
          details: {
            added: next.length,
            ids: next.map((message) => message.id),
          },
        }
      },
    })
  }, [runLoggedOperation])

  const toggleDynamicHeight = useCallback(() => {
    void runLoggedOperation({
      operation: 'message.resize',
      startEvent: 'resizing latest messages...',
      details: { affectedTailCount: 10 },
      apply: () => {
        messagesRef.current = messagesRef.current.map((message, index, list) =>
          index >= list.length - 10
            ? { ...message, expanded: !message.expanded }
            : message,
        )

        return {
          effect: 'items-change',
          kind: 'patch',
          eventText: 'resized latest messages',
          details: { affectedTailCount: Math.min(10, messagesRef.current.length) },
        }
      },
    })
  }, [runLoggedOperation])

  const sendMessage = useCallback((body: string): boolean => {
    const trimmed = body.trim()

    if (!trimmed) {
      return false
    }

    void runLoggedOperation({
      operation: 'message.send',
      startEvent: 'sending message...',
      details: { bodyLength: trimmed.length, lineCount: trimmed.split('\n').length },
      apply: (feedId) => {
        const message = createOutgoingMessage(trimmed, {
          feedId,
          sequence: getNextMessageSequence(messagesRef.current),
        })

        messagesRef.current = [...messagesRef.current, message]

        return {
          effect: 'auto-scroll-to-bottom',
          kind: 'append',
          eventText: `sent ${message.id}`,
          details: { sentId: message.id, bodyLength: trimmed.length },
        }
      },
    })

    return true
  }, [runLoggedOperation])

  const followBottom = useCallback((source: 'sidebar' | 'floating') => {
    void log({
      requestId: createDemoRequestId('runtime.command.followBottom'),
      operation: 'runtime.command.followBottom',
      phase: 'info',
      feedId: activeFeedIdRef.current,
      messageCount: messagesRef.current.length,
      details: { source },
    })
    runtime.dispatch({ type: 'followBottom' })
  }, [log, runtime])

  const selectFeed = useCallback((feedId: string) => {
    if (feedId === activeFeedIdRef.current) {
      return
    }

    void log({
      requestId: createDemoRequestId('feed.select'),
      operation: 'feed.select',
      phase: 'start',
      feedId: activeFeedIdRef.current,
      messageCount: messagesRef.current.length,
      details: { nextFeedId: feedId },
    })
    feedLoadingRef.current = true
    setFeedLoading(true)
    setLastEvent(`loading ${getDemoFeedDefinition(feedId).title}...`)
    setActiveFeedId(feedId)
  }, [log])

  const clearFeed = useCallback((feedId: string) => {
    const feed = getDemoFeedDefinition(feedId)
    const requestId = createDemoRequestId('feed.clear')

    beginPendingOperation('feed.clear')
    setLastEvent(`clearing ${feed.title}...`)

    /**
     * 清空会话是一个真实异步 demo 请求：它会写日志、更新本地 DB。
     * 只有清空当前 active feed 时，才同步发布空 snapshot 给 runtime。
     */
    void (async () => {
      const isActiveAtStart = activeFeedIdRef.current === feedId
      const previousMessageCount = isActiveAtStart
        ? messagesRef.current.length
        : undefined

      await log({
        requestId,
        operation: 'feed.clear',
        phase: 'start',
        feedId,
        messageCount: previousMessageCount,
        details: { title: feed.title, active: isActiveAtStart },
      })

      try {
        await sleep(OPERATION_DELAYS['feed.clear'])

        const persisted = await loadPersistedDemoFeed(feedId)
        const isActiveAfterDelay = activeFeedIdRef.current === feedId
        const nextRevision = Math.max(
          1,
          (isActiveAfterDelay ? revisionRef.current : persisted?.revision ?? 1) + 1,
        )

        await savePersistedDemoFeed({
          version: 1,
          feedId,
          revision: nextRevision,
          hasMoreBefore: false,
          messages: [],
          updatedAt: new Date().toISOString(),
        })

        if (isActiveAfterDelay) {
          revisionRef.current = nextRevision
          hasMoreBeforeRef.current = false
          messagesRef.current = []
          setMessageCount(0)
          runtime.setDataSnapshot(
            createDemoSnapshot({
              feedId,
              generation: generationRef.current,
              messages: [],
              revision: nextRevision,
              effect: 'reset',
              kind: 'reset',
              hasMoreBefore: false,
            }),
          )
          runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
        }

        setLastEvent(`cleared ${feed.title}`)
        await log({
          requestId,
          operation: 'feed.clear',
          phase: 'success',
          feedId,
          messageCount: 0,
          details: {
            active: isActiveAfterDelay,
            hasMoreBefore: false,
            previousMessageCount:
              previousMessageCount ?? persisted?.messages.length ?? 0,
            revision: nextRevision,
          },
        })
      } catch (error) {
        setLastEvent(`clear ${feed.title} failed`)
        await log({
          requestId,
          operation: 'feed.clear',
          phase: 'error',
          feedId,
          messageCount: previousMessageCount,
          error: getErrorMessage(error),
        })
      } finally {
        endPendingOperation()
      }
    })()
  }, [beginPendingOperation, endPendingOperation, log, runtime])

  useEffect(() => {
    const token = loadTokenRef.current + 1
    const feed = getDemoFeedDefinition(activeFeedId)
    const requestId = createDemoRequestId('feed.load')

    loadTokenRef.current = token
    activeFeedIdRef.current = activeFeedId
    feedLoadingRef.current = true

    async function loadFeed(): Promise<void> {
      await log({
        requestId,
        operation: 'feed.load',
        phase: 'start',
        feedId: activeFeedId,
        messageCount: messagesRef.current.length,
        details: { title: feed.title },
      })

      try {
        await sleep(FEED_LOAD_DELAY_MS)

        const persisted = await loadPersistedDemoFeed(activeFeedId)
        const messages = persisted
          ? normalizeDemoMessages(activeFeedId, persisted.messages)
          : createDemoMessages(feed.seedCount, activeFeedId)
        const revision = persisted?.revision ?? 1
        const hasMoreBefore =
          persisted?.hasMoreBefore ?? (persisted ? messages.length > 0 : true)

        if (loadTokenRef.current !== token) {
          await log({
            requestId,
            operation: 'feed.load',
            phase: 'cancel',
            feedId: activeFeedId,
            messageCount: messages.length,
            details: { reason: 'stale-load' },
          })
          return
        }

        if (!persisted) {
          await savePersistedDemoFeed({
            version: 1,
            feedId: activeFeedId,
            revision,
            hasMoreBefore,
            messages,
            updatedAt: new Date().toISOString(),
          })
          await log({
            requestId: createDemoRequestId('feed.seed'),
            operation: 'feed.seed',
            phase: 'success',
            feedId: activeFeedId,
            messageCount: messages.length,
            details: { seedCount: feed.seedCount, hasMoreBefore },
          })
        }

        generationRef.current += 1
        revisionRef.current = revision
        hasMoreBeforeRef.current = hasMoreBefore
        messagesRef.current = messages
        setMessageCount(messages.length)
        runtime.setDataSnapshot(
          createDemoSnapshot({
            feedId: activeFeedId,
            generation: generationRef.current,
            messages,
            revision,
            effect: 'reset',
            kind: 'initial',
            hasMoreBefore,
          }),
        )
        runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
        setLastEvent(persisted ? `loaded ${feed.title}` : `seeded ${feed.title}`)

        await log({
          requestId,
          operation: 'feed.load',
          phase: 'success',
          feedId: activeFeedId,
          messageCount: messages.length,
          details: { persisted: Boolean(persisted), revision, hasMoreBefore },
        })
      } catch (error) {
        setLastEvent('feed load failed')
        await log({
          requestId,
          operation: 'feed.load',
          phase: 'error',
          feedId: activeFeedId,
          error: getErrorMessage(error),
        })
      } finally {
        if (loadTokenRef.current === token) {
          feedLoadingRef.current = false
          setFeedLoading(false)
        }
      }
    }

    void loadFeed()
  }, [activeFeedId, log, runtime])

  useEffect(() => {
    const unsubscribe = runtime.subscribeEvent((event) => {
      void log({
        requestId: createDemoRequestId('runtime.event'),
        operation: 'runtime.event',
        phase: 'info',
        feedId: event.feedId,
        messageCount: messagesRef.current.length,
        details: event,
      })

      setLastEvent(event.type)

      if (
        event.type === 'needMoreBefore' &&
        event.feedId === activeFeedIdRef.current
      ) {
        loadHistoryBatch('auto')
      }
    })

    return unsubscribe
  }, [loadHistoryBatch, log, runtime])

  return {
    feeds: DEMO_FEEDS,
    activeFeedId,
    activeFeed,
    messageCount,
    loadingBefore,
    feedLoading,
    pendingOperation,
    lastEvent,
    selectFeed,
    loadHistoryBatch,
    appendMessage,
    appendLongBurst,
    toggleDynamicHeight,
    sendMessage,
    followBottom,
    clearFeed,
  }
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, timeoutMs)
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
