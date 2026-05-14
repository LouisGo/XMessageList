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
  createOutgoingMessage,
  getNextMessageSequence,
  normalizeDemoMessages,
} from './demoData'
import {
  DEMO_FEEDS,
  getDemoFeedDefinition,
  type DemoFeedDefinition,
} from './demoFeeds'
import {
  getLatestMessages,
  getMessagesAround,
} from './demoMessageApi'
import {
  createDemoRequestId,
  type DemoLogEntry,
  type DemoOperationName,
  loadPersistedDemoFeed,
  savePersistedDemoFeed,
  writeDemoLog,
} from './demoLocalStoreClient'

const PAGE_SIZE = 20
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
  'history.prepend': 200,
  'message.append': 80,
  'message.longBurst': 620,
  'message.resize': 200,
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
  apply: (feedId: string) => LoggedOperationResult | Promise<LoggedOperationResult>
  onFinally?: () => void
  /** 为 true 时跳过 apply 后的 persistCurrentFeed（apply 自行处理持久化）。 */
  skipPersist?: boolean
}

export type DemoMessageScenario = {
  feeds: DemoFeedDefinition[]
  activeFeedId: string
  activeFeed: DemoFeedDefinition
  // 整个 feed 的持久化总数，不等于 runtime 当前已加载窗口大小。
  messageCount: number
  // 当前已经加载进 runtime data snapshot 的消息数。
  loadedMessageCount: number
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
  const [loadedMessageCount, setLoadedMessageCount] = useState(0)
  const [loadingBefore, setLoadingBefore] = useState(false)
  const [feedLoading, setFeedLoading] = useState(true)
  const [pendingOperation, setPendingOperation] = useState('idle')
  const [lastEvent, setLastEvent] = useState(
    `loading ${getDemoFeedDefinition(initialFeedId).title}...`,
  )

  const activeFeedIdRef = useRef(activeFeedId)
  // 当前交给 runtime 的 data window。
  const messagesRef = useRef<DemoMessage[]>([])
  // 当前 feed 在本地持久化层的完整消息集。
  const feedMessagesRef = useRef<DemoMessage[]>([])
  const revisionRef = useRef(1)
  const generationRef = useRef(1)
  const hasMoreBeforeRef = useRef(false)
  const loadingBeforeRef = useRef(false)
  const feedLoadingRef = useRef(false)
  const loadTokenRef = useRef(0)
  const pendingOperationCountRef = useRef(0)
  const activeOperationsRef = useRef(new Map<string, number>())

  const activeFeed = useMemo(
    () => getDemoFeedDefinition(activeFeedId),
    [activeFeedId],
  )

  useEffect(() => {
    activeFeedIdRef.current = activeFeedId
  }, [activeFeedId])

  const log = useCallback((entry: DemoLogEntry) => writeDemoLog(entry), [])

  const syncDisplayedCounts = useCallback(() => {
    setMessageCount(feedMessagesRef.current.length)
    setLoadedMessageCount(messagesRef.current.length)
  }, [])

  const beginPendingOperation = useCallback((operation: string) => {
    pendingOperationCountRef.current += 1
    const nextCount = (activeOperationsRef.current.get(operation) ?? 0) + 1
    activeOperationsRef.current.set(operation, nextCount)
    setPendingOperation(formatPendingOperations(activeOperationsRef.current))
  }, [])

  const endPendingOperation = useCallback((operation: string) => {
    pendingOperationCountRef.current = Math.max(
      0,
      pendingOperationCountRef.current - 1,
    )

    const currentCount = activeOperationsRef.current.get(operation) ?? 0

    if (currentCount <= 1) {
      activeOperationsRef.current.delete(operation)
    } else {
      activeOperationsRef.current.set(operation, currentCount - 1)
    }

    if (pendingOperationCountRef.current === 0) {
      setPendingOperation('idle')
      activeOperationsRef.current.clear()
      return
    }

    setPendingOperation(formatPendingOperations(activeOperationsRef.current))
  }, [])

  /**
   * 所有会改动消息数组的 demo 请求都通过这一层发布给 runtime。
   * revision 只表达数据快照版本，feed/generation 则用于切会话时隔离 runtime 生命周期。
   * Demo 需要同时维护“完整 feed”与“当前 loaded window”两层状态，不能混用。
   */
  const publishCurrentMessages = useCallback((
    effect: ViewportEffect,
    kind: DemoSnapshotKind,
  ) => {
    revisionRef.current += 1
    syncDisplayedCounts()
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
  }, [runtime, syncDisplayedCounts])

  const persistCurrentFeed = useCallback(async () => {
    await savePersistedDemoFeed({
      version: 1,
      feedId: activeFeedIdRef.current,
      revision: revisionRef.current,
      hasMoreBefore: hasMoreBeforeRef.current,
      messages: feedMessagesRef.current,
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

      const result = await input.apply(feedId)

      publishCurrentMessages(result.effect, result.kind)

      if (!input.skipPersist) {
        await persistCurrentFeed()
      }

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
      endPendingOperation(input.operation)
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
      details: { batchSize: PAGE_SIZE, source },
      apply: async (feedId) => {
        // 先同步完整持久化 feed。分页边界必须由 BFF + 持久化数据共同决定，
        // demo 不能在触顶后私自再造更老消息，否则会把一个有限 feed 伪装成无限历史。
        const storeFeed = await loadPersistedDemoFeed(feedId)
        feedMessagesRef.current = storeFeed
          ? normalizeDemoMessages(feedId, storeFeed.messages)
          : []

        const oldestViewportMsg = messagesRef.current[0]
        if (!oldestViewportMsg) {
          return {
            effect: 'none' as ViewportEffect,
            kind: 'patch' as DemoSnapshotKind,
            eventText: 'no messages in viewport',
          }
        }

        const resp = await getMessagesAround({
          feedId,
          anchor: { messageId: oldestViewportMsg.id },
          before: PAGE_SIZE,
          after: 0,
        })

        if (!resp.ok) {
          throw new Error(resp.errorMessage)
        }

        // BFF 返回 anchor 之前的消息，前端与当前视口合并
        const olderInView = resp.messages.filter(
          (message) => message.id !== oldestViewportMsg.id,
        )
        messagesRef.current = [...olderInView, ...messagesRef.current]
        // 是否还能继续向上分页只能信任 BFF；不能再做“非空 feed 就还有历史”的本地推断。
        hasMoreBeforeRef.current = resp.hasMoreBefore

        return {
          effect: 'prepend' as ViewportEffect,
          kind: 'prepend' as DemoSnapshotKind,
          eventText: `loaded ${olderInView.length} older messages`,
          details: {
            total: resp.total,
            hasMoreBefore: resp.hasMoreBefore,
            added: olderInView.length,
            anchor: resp.anchor,
          },
        }
      },
      onFinally: () => {
        loadingBeforeRef.current = false
        setLoadingBefore(false)
      },
      skipPersist: true, // prepend 只改变 loaded window，不应覆写完整持久化 feed
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
          sequence: getNextMessageSequence(feedMessagesRef.current),
        })

        feedMessagesRef.current = [...feedMessagesRef.current, message]
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
        const startSequence = getNextMessageSequence(feedMessagesRef.current)
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

        feedMessagesRef.current = [...feedMessagesRef.current, ...next]
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
        const toggledIds = new Set<string>()

        messagesRef.current = messagesRef.current.map((message, index, list) => {
          if (index < list.length - 10) {
            return message
          }

          toggledIds.add(message.id)
          return { ...message, expanded: !message.expanded }
        })
        feedMessagesRef.current = feedMessagesRef.current.map((message) =>
          toggledIds.has(message.id)
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
          sequence: getNextMessageSequence(feedMessagesRef.current),
        })

        feedMessagesRef.current = [...feedMessagesRef.current, message]
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
          feedMessagesRef.current = []
          messagesRef.current = []
          syncDisplayedCounts()
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
        endPendingOperation('feed.clear')
      }
    })()
  }, [beginPendingOperation, endPendingOperation, log, runtime, syncDisplayedCounts])

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

        // 通过 BFF 获取最新消息；若 store 中不存在则先 seed 再重试
        const firstResp = await getLatestMessages({
          feedId: activeFeedId,
          limit: PAGE_SIZE,
        })

        let resp = firstResp.ok
          ? firstResp
          : undefined

        if (!firstResp.ok) {
          if (firstResp.errorCode !== 'feed-not-found') {
            throw new Error(firstResp.errorMessage)
          }

          const seedMessages = createDemoMessages(feed.seedCount, activeFeedId)
          feedMessagesRef.current = seedMessages
          await savePersistedDemoFeed({
            version: 1,
            feedId: activeFeedId,
            revision: 1,
            hasMoreBefore: true,
            messages: seedMessages,
            updatedAt: new Date().toISOString(),
          })
          await log({
            requestId: createDemoRequestId('feed.seed'),
            operation: 'feed.seed',
            phase: 'success',
            feedId: activeFeedId,
            messageCount: seedMessages.length,
            details: { seedCount: feed.seedCount },
          })
          const retryResp = await getLatestMessages({
            feedId: activeFeedId,
            limit: PAGE_SIZE,
          })

          if (!retryResp.ok) {
            throw new Error(retryResp.errorMessage)
          }

          resp = retryResp
        }

        const persistedFeed = await loadPersistedDemoFeed(activeFeedId)

        if (!persistedFeed) {
          throw new Error(`feed ${activeFeedId} missing after load`)
        }

        if (loadTokenRef.current !== token) {
          await log({
            requestId,
            operation: 'feed.load',
            phase: 'cancel',
            feedId: activeFeedId,
            messageCount: resp ? resp.messages.length : 0,
            details: { reason: 'stale-load' },
          })
          return
        }

        generationRef.current += 1
        revisionRef.current += 1
        hasMoreBeforeRef.current = resp.hasMoreBefore
        feedMessagesRef.current = normalizeDemoMessages(
          activeFeedId,
          persistedFeed.messages,
        )
        messagesRef.current = resp.messages
        syncDisplayedCounts()
        runtime.setDataSnapshot(
          createDemoSnapshot({
            feedId: activeFeedId,
            generation: generationRef.current,
            messages: resp.messages,
            revision: revisionRef.current,
            effect: 'reset',
            kind: 'initial',
            hasMoreBefore: resp.hasMoreBefore,
          }),
        )
        runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
        setLastEvent(
          resp.messages.length > 0 ? `loaded ${feed.title}` : `seeded ${feed.title}`,
        )

        await log({
          requestId,
          operation: 'feed.load',
          phase: 'success',
          feedId: activeFeedId,
          messageCount: resp.messages.length,
          details: {
            total: resp.total,
            hasMoreBefore: resp.hasMoreBefore,
            anchor: resp.anchor,
          },
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
  }, [activeFeedId, log, runtime, syncDisplayedCounts])

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
    loadedMessageCount,
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

function formatPendingOperations(operations: Map<string, number>): string {
  const active = Array.from(operations.entries())

  if (active.length === 0) {
    return 'idle'
  }

  return active
    .map(([operation, count]) =>
      count > 1 ? `${operation} ×${count}` : operation,
    )
    .join(' + ')
}
