import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  AnchorState,
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
import type {
  GetLatestMessagesResp,
  GetMessagesAroundResp,
} from './demoMessageApiTypes'
import {
  createDemoRequestId,
  type DemoLogEntry,
  type DemoOperationName,
  loadPersistedDemoFeed,
  type PersistedViewportAnchor,
  savePersistedDemoFeed,
  writeDemoLog,
} from './demoLocalStoreClient'

const PAGE_SIZE = 20
const FEED_LOAD_DELAY_MS = 180
const RESTORE_BEFORE_PAGE_SIZE = Math.max(1, Math.floor(PAGE_SIZE / 2))
const RESTORE_AFTER_PAGE_SIZE = PAGE_SIZE
const REACTION_EMOJIS = ['😀', '😂', '🔥', '👍', '🎉', '😭', '👀', '❤️', '🚀', '🥲']

const OPERATION_DELAYS: Record<
  Extract<
    DemoOperationName,
    | 'history.prepend'
    | 'history.append'
    | 'message.append'
    | 'message.longBurst'
    | 'message.edit'
    | 'message.delete'
    | 'message.react'
    | 'message.resize'
    | 'message.send'
    | 'feed.clear'
  >,
  number
> = {
  'history.prepend': 200,
  'history.append': 200,
  'message.append': 80,
  'message.longBurst': 620,
  'message.edit': 100,
  'message.delete': 90,
  'message.react': 70,
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
  onSuccess?: (result: LoggedOperationResult) => void
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
  editMessage: (messageId: string, nextBody: string) => void
  deleteMessage: (messageId: string) => void
  reactToMessage: (messageId: string) => void
  toggleDynamicHeight: () => void
  sendMessage: (body: string) => boolean
  followBottom: (source: 'sidebar' | 'floating') => void
  clearFeed: (feedId: string) => void
  rememberViewportAnchor: (
    reason: 'scroll-idle' | 'before-feed-switch' | 'before-unmount',
  ) => void
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
  const hasMoreAfterRef = useRef(false)
  const lastViewportAnchorRef = useRef<PersistedViewportAnchor | undefined>(undefined)
  const loadingBeforeRef = useRef(false)
  const loadingAfterRef = useRef(false)
  const feedLoadingRef = useRef(false)
  const downwardScrollModeRef = useRef<'idle' | 'follow-bottom'>('idle')
  const loadFutureBatchRef = useRef<
    ((source: 'edge-user' | 'follow-bottom') => void) | null
  >(null)
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
    hasMoreBeforeRef.current = computeHasMoreBefore(
      feedMessagesRef.current,
      messagesRef.current,
    )
    hasMoreAfterRef.current = computeHasMoreAfter(
      feedMessagesRef.current,
      messagesRef.current,
    )
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
        hasMoreAfter: hasMoreAfterRef.current,
      }),
    )
  }, [runtime, syncDisplayedCounts])

  const persistCurrentFeed = useCallback(async () => {
    await savePersistedDemoFeed({
      version: 1,
      feedId: activeFeedIdRef.current,
      revision: revisionRef.current,
      hasMoreBefore: hasMoreBeforeRef.current,
      lastViewportAnchor: lastViewportAnchorRef.current,
      messages: feedMessagesRef.current,
      updatedAt: new Date().toISOString(),
    })
  }, [])

  const rememberViewportAnchor = useCallback((
    reason: 'scroll-idle' | 'before-feed-switch' | 'before-unmount',
  ) => {
    if (feedLoadingRef.current || feedMessagesRef.current.length === 0) {
      return
    }

    const runtimeAnchor = runtime.getViewportAnchorState()

    if (!runtimeAnchor) {
      return
    }

    const { key } = runtimeAnchor

    if (key.kind !== 'committed') {
      return
    }

    const anchorMessage = feedMessagesRef.current.find(
      (message) => message.id === key.messageId,
    )

    if (!anchorMessage) {
      return
    }

    const nextAnchor: PersistedViewportAnchor = {
      messageId: anchorMessage.id,
      position: anchorMessage.sequence,
      offsetWithinMessage: runtimeAnchor.offsetWithinMessage,
    }

    if (isSameViewportAnchor(lastViewportAnchorRef.current, nextAnchor)) {
      return
    }

    lastViewportAnchorRef.current = nextAnchor

    void savePersistedDemoFeed({
      version: 1,
      feedId: activeFeedIdRef.current,
      revision: revisionRef.current,
      hasMoreBefore: hasMoreBeforeRef.current,
      lastViewportAnchor: nextAnchor,
      messages: feedMessagesRef.current,
      updatedAt: new Date().toISOString(),
    })

    void log({
      requestId: createDemoRequestId('runtime.event'),
      operation: 'runtime.event',
      phase: 'info',
      feedId: activeFeedIdRef.current,
      messageCount: messagesRef.current.length,
      details: {
        type: 'viewportAnchorRemembered',
        reason,
        anchor: nextAnchor,
      },
    })
  }, [log, runtime])

  const updateMessageCollections = useCallback((
    messageId: string,
    mutate: (message: DemoMessage) => DemoMessage | null,
  ): { previous: DemoMessage; next: DemoMessage | null } => {
    let previousMessage: DemoMessage | null = null
    let nextMessage: DemoMessage | null = null

    feedMessagesRef.current = feedMessagesRef.current.flatMap((message) => {
      if (message.id !== messageId) {
        return [message]
      }

      previousMessage = message
      nextMessage = mutate(message)
      return nextMessage ? [nextMessage] : []
    })

    messagesRef.current = messagesRef.current.flatMap((message) => {
      if (message.id !== messageId) {
        return [message]
      }

      return nextMessage ? [nextMessage] : []
    })

    if (!previousMessage) {
      throw new Error(`message ${messageId} not found`)
    }

    return {
      previous: previousMessage,
      next: nextMessage,
    }
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

      input.onSuccess?.(result)
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

        if (isErrorResponse(resp)) {
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

  const loadFutureBatch = useCallback((
    source: 'edge-user' | 'follow-bottom',
  ) => {
    if (!hasMoreAfterRef.current) {
      void log({
        requestId: createDemoRequestId('history.append'),
        operation: 'history.append',
        phase: 'skip',
        feedId: activeFeedIdRef.current,
        messageCount: messagesRef.current.length,
        details: { reason: 'future-unavailable', source },
      })
      return
    }

    if (loadingAfterRef.current) {
      void log({
        requestId: createDemoRequestId('history.append'),
        operation: 'history.append',
        phase: 'skip',
        feedId: activeFeedIdRef.current,
        messageCount: messagesRef.current.length,
        details: { reason: 'already-loading', source },
      })
      return
    }

    loadingAfterRef.current = true
    const requestFeedId = activeFeedIdRef.current

    void runLoggedOperation({
      operation: 'history.append',
      startEvent: 'loading newer messages...',
      details: { batchSize: PAGE_SIZE, source },
      apply: async (feedId) => {
        const storeFeed = await loadPersistedDemoFeed(feedId)
        feedMessagesRef.current = storeFeed
          ? normalizeDemoMessages(feedId, storeFeed.messages)
          : []

        const newestViewportMsg = messagesRef.current.at(-1)
        if (!newestViewportMsg) {
          return {
            effect: 'none' as ViewportEffect,
            kind: 'patch' as DemoSnapshotKind,
            eventText: 'no messages in viewport',
          }
        }

        const resp = await getMessagesAround({
          feedId,
          anchor: { messageId: newestViewportMsg.id },
          before: 0,
          after: PAGE_SIZE,
        })

        if (isErrorResponse(resp)) {
          throw new Error(resp.errorMessage)
        }

        const newerInView = resp.messages.filter(
          (message) => message.id !== newestViewportMsg.id,
        )
        const previousLoadedLastId = newestViewportMsg.id
        messagesRef.current = [...messagesRef.current, ...newerInView]
        hasMoreAfterRef.current = resp.hasMoreAfter

        return {
          effect: 'append' as ViewportEffect,
          kind: 'append' as DemoSnapshotKind,
          eventText: `loaded ${newerInView.length} newer messages`,
          details: {
            total: resp.total,
            source,
            hasMoreAfter: resp.hasMoreAfter,
            added: newerInView.length,
            previousLoadedLastId,
            nextLoadedLastId: messagesRef.current.at(-1)?.id,
            anchor: resp.anchor,
          },
        }
      },
      onFinally: () => {
        loadingAfterRef.current = false

        if (downwardScrollModeRef.current !== 'follow-bottom') {
          return
        }

        if (activeFeedIdRef.current !== requestFeedId) {
          downwardScrollModeRef.current = 'idle'
          return
        }

        if (hasMoreAfterRef.current) {
          loadFutureBatchRef.current?.('follow-bottom')
          return
        }

        runtime.dispatch({ type: 'followBottom' })
        downwardScrollModeRef.current = 'idle'
      },
      skipPersist: true,
    })
  }, [log, runLoggedOperation, runtime])

  useEffect(() => {
    loadFutureBatchRef.current = loadFutureBatch
  }, [loadFutureBatch])

  const appendMessage = useCallback(() => {
    void runLoggedOperation({
      operation: 'message.append',
      startEvent: 'appending mock message...',
      details: { source: 'button' },
      apply: (feedId) => {
        const projectsIntoCurrentWindow = !hasMoreAfterRef.current
        const message = createNewestMessage({
          feedId,
          sequence: getNextMessageSequence(feedMessagesRef.current),
        })

        feedMessagesRef.current = [...feedMessagesRef.current, message]
        if (projectsIntoCurrentWindow) {
          messagesRef.current = [...messagesRef.current, message]
        }

        return {
          effect: projectsIntoCurrentWindow ? 'append' : 'none',
          kind: projectsIntoCurrentWindow ? 'append' : 'patch',
          eventText: projectsIntoCurrentWindow
            ? `appended ${message.id}`
            : `queued ${message.id} after current window`,
          details: {
            appendedId: message.id,
            kind: message.kind,
            visibleInCurrentWindow: projectsIntoCurrentWindow,
          },
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
        const projectsIntoCurrentWindow = !hasMoreAfterRef.current
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
        if (projectsIntoCurrentWindow) {
          messagesRef.current = [...messagesRef.current, ...next]
        }

        return {
          effect: projectsIntoCurrentWindow ? 'append' : 'none',
          kind: projectsIntoCurrentWindow ? 'append' : 'patch',
          eventText: projectsIntoCurrentWindow
            ? `appended long burst ${next.length}`
            : `queued long burst ${next.length} after current window`,
          details: {
            added: next.length,
            ids: next.map((message) => message.id),
            visibleInCurrentWindow: projectsIntoCurrentWindow,
          },
        }
      },
    })
  }, [runLoggedOperation])

  const editMessage = useCallback((messageId: string, nextBody: string) => {
    const trimmed = nextBody.trim()

    if (!trimmed) {
      return
    }

    const target = messagesRef.current.find((message) => message.id === messageId)

    if (!target || target.tone !== 'self' || target.body === trimmed) {
      return
    }

    void runLoggedOperation({
      operation: 'message.edit',
      startEvent: `editing ${messageId}...`,
      details: { messageId, nextBodyLength: trimmed.length },
      apply: () => {
        const { next } = updateMessageCollections(messageId, (message) => ({
          ...message,
          body: trimmed,
          kind: getEditedMessageKind(message.kind, trimmed),
          editedAt: new Date().toISOString(),
        }))

        if (!next) {
          throw new Error(`message ${messageId} deleted during edit`)
        }

        return {
          effect: 'items-change',
          kind: 'patch',
          eventText: `edited ${next.id}`,
          details: {
            messageId: next.id,
            editedAt: next.editedAt,
            kind: next.kind,
          },
        }
      },
    })
  }, [runLoggedOperation, updateMessageCollections])

  const deleteMessage = useCallback((messageId: string) => {
    void runLoggedOperation({
      operation: 'message.delete',
      startEvent: `deleting ${messageId}...`,
      details: { messageId },
      apply: () => {
        const { previous } = updateMessageCollections(messageId, () => null)

        return {
          effect: 'items-change',
          kind: 'delete',
          eventText: `deleted ${previous.id}`,
          details: { messageId: previous.id },
        }
      },
    })
  }, [runLoggedOperation, updateMessageCollections])

  const reactToMessage = useCallback((messageId: string) => {
    void runLoggedOperation({
      operation: 'message.react',
      startEvent: `reacting to ${messageId}...`,
      details: { messageId },
      apply: () => {
        const { next } = updateMessageCollections(messageId, (message) => ({
          ...message,
          reactions: [...message.reactions, getRandomReaction()],
        }))

        if (!next) {
          throw new Error(`message ${messageId} deleted during reaction`)
        }

        return {
          effect: 'items-change',
          kind: 'patch',
          eventText: `reacted to ${next.id}`,
          details: {
            messageId: next.id,
            reactionCount: next.reactions.length,
            latestReaction: next.reactions.at(-1),
          },
        }
      },
    })
  }, [runLoggedOperation, updateMessageCollections])

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
      apply: async (feedId) => {
        const projectsIntoCurrentWindow = !hasMoreAfterRef.current
        const message = createOutgoingMessage(trimmed, {
          feedId,
          sequence: getNextMessageSequence(feedMessagesRef.current),
        })

        feedMessagesRef.current = [...feedMessagesRef.current, message]
        // 用户主动发送消息是明确的 latest intent：旧的中间阅读 anchor 不能继续影响恢复。
        lastViewportAnchorRef.current = undefined

        if (projectsIntoCurrentWindow) {
          messagesRef.current = [...messagesRef.current, message]

          return {
            effect: 'auto-scroll-to-bottom' as ViewportEffect,
            kind: 'append' as DemoSnapshotKind,
            eventText: `sent ${message.id}`,
            details: {
              sentId: message.id,
              bodyLength: trimmed.length,
              visibleInCurrentWindow: true,
              rebuiltLatestWindow: false,
            },
          }
        }

        // 当前窗口不是 latest 时，send 需要模拟真实 IM：写入后重新请求 latest page，
        // 让 runtime 从底部重建 projection，而不是把自发消息排在不可见窗口外。
        await savePersistedDemoFeed({
          version: 1,
          feedId,
          revision: revisionRef.current,
          hasMoreBefore: hasMoreBeforeRef.current,
          lastViewportAnchor: undefined,
          messages: feedMessagesRef.current,
          updatedAt: new Date().toISOString(),
        })

        const latestResp = await getLatestMessages({
          feedId,
          limit: PAGE_SIZE,
        })

        if (isErrorResponse(latestResp)) {
          throw new Error(latestResp.errorMessage)
        }

        messagesRef.current = normalizeDemoMessages(feedId, latestResp.messages)
        hasMoreBeforeRef.current = latestResp.hasMoreBefore
        hasMoreAfterRef.current = latestResp.hasMoreAfter

        return {
          effect: 'auto-scroll-to-bottom' as ViewportEffect,
          kind: 'reset' as DemoSnapshotKind,
          eventText: `sent ${message.id} and rebuilt latest`,
          details: {
            sentId: message.id,
            bodyLength: trimmed.length,
            visibleInCurrentWindow: true,
            rebuiltLatestWindow: true,
            latestTotal: latestResp.total,
            hasMoreBefore: latestResp.hasMoreBefore,
            hasMoreAfter: latestResp.hasMoreAfter,
            anchor: latestResp.anchor,
          },
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
    downwardScrollModeRef.current = 'follow-bottom'

    if (loadingAfterRef.current) {
      return
    }

    if (hasMoreAfterRef.current) {
      void loadFutureBatch('follow-bottom')
      return
    }

    runtime.dispatch({ type: 'followBottom' })
    downwardScrollModeRef.current = 'idle'
  }, [loadFutureBatch, log, runtime])

  const selectFeed = useCallback((feedId: string) => {
    if (feedId === activeFeedIdRef.current) {
      return
    }

    rememberViewportAnchor('before-feed-switch')

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
  }, [log, rememberViewportAnchor])

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
          lastViewportAnchor: undefined,
          messages: [],
          updatedAt: new Date().toISOString(),
        })

        if (isActiveAfterDelay) {
          revisionRef.current = nextRevision
          hasMoreBeforeRef.current = false
          hasMoreAfterRef.current = false
          lastViewportAnchorRef.current = undefined
          downwardScrollModeRef.current = 'idle'
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
              hasMoreAfter: false,
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
    return () => {
      rememberViewportAnchor('before-unmount')
    }
  }, [rememberViewportAnchor])

  useEffect(() => {
    const token = loadTokenRef.current + 1
    const feed = getDemoFeedDefinition(activeFeedId)
    const requestId = createDemoRequestId('feed.load')

    loadTokenRef.current = token
    activeFeedIdRef.current = activeFeedId
    feedLoadingRef.current = true
    downwardScrollModeRef.current = 'idle'

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

        let persistedFeed = await loadPersistedDemoFeed(activeFeedId)

        if (!persistedFeed) {
          const seedMessages = createDemoMessages(feed.seedCount, activeFeedId)
          persistedFeed = {
            version: 1,
            feedId: activeFeedId,
            revision: 1,
            hasMoreBefore: true,
            lastViewportAnchor: undefined,
            messages: seedMessages,
            updatedAt: new Date().toISOString(),
          }
          await savePersistedDemoFeed(persistedFeed)
          await log({
            requestId: createDemoRequestId('feed.seed'),
            operation: 'feed.seed',
            phase: 'success',
            feedId: activeFeedId,
            messageCount: seedMessages.length,
            details: { seedCount: feed.seedCount },
          })
        }

        const normalizedFeedMessages = normalizeDemoMessages(
          activeFeedId,
          persistedFeed.messages,
        )
        const persistedViewportAnchor = persistedFeed.lastViewportAnchor
        let bootstrapMode: 'latest' | 'restored' = 'latest'
        let bootstrapTarget: AnchorState | undefined
        let usedPersistedViewportAnchor = false
        let restoreResp: GetMessagesAroundResp<DemoMessage> | null = null
        let resp: GetLatestMessagesResp<DemoMessage> | GetMessagesAroundResp<DemoMessage>

        if (persistedViewportAnchor) {
          restoreResp = await getMessagesAround({
            feedId: activeFeedId,
            anchor: {
              messageId: persistedViewportAnchor.messageId,
              position: persistedViewportAnchor.position,
            },
            before: RESTORE_BEFORE_PAGE_SIZE,
            after: RESTORE_AFTER_PAGE_SIZE,
          })
          resp = restoreResp
          usedPersistedViewportAnchor = restoreResp.ok
        } else {
          resp = await getLatestMessages({
            feedId: activeFeedId,
            limit: PAGE_SIZE,
          })
        }

        if (persistedViewportAnchor && isErrorResponse(resp)) {
          resp = await getLatestMessages({
            feedId: activeFeedId,
            limit: PAGE_SIZE,
          })
        }

        if (isErrorResponse(resp)) {
          throw new Error(resp.errorMessage)
        }

        if (persistedViewportAnchor && usedPersistedViewportAnchor) {
          bootstrapMode = 'restored'
          bootstrapTarget = {
            key: { kind: 'committed', messageId: resp.anchor.messageId },
            offsetWithinMessage: persistedViewportAnchor.offsetWithinMessage,
          }
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
        lastViewportAnchorRef.current = usedPersistedViewportAnchor
          ? persistedViewportAnchor
          : undefined
        feedMessagesRef.current = normalizedFeedMessages
        messagesRef.current = normalizeDemoMessages(activeFeedId, resp.messages)
        hasMoreBeforeRef.current = computeHasMoreBefore(
          feedMessagesRef.current,
          messagesRef.current,
        )
        hasMoreAfterRef.current = computeHasMoreAfter(
          feedMessagesRef.current,
          messagesRef.current,
        )
        syncDisplayedCounts()

        if (persistedViewportAnchor && !usedPersistedViewportAnchor) {
          await savePersistedDemoFeed({
            ...persistedFeed,
            messages: normalizedFeedMessages,
            lastViewportAnchor: undefined,
            updatedAt: new Date().toISOString(),
          })
        }

        runtime.setDataSnapshot(
          createDemoSnapshot({
            feedId: activeFeedId,
            generation: generationRef.current,
            messages: messagesRef.current,
            revision: revisionRef.current,
            effect: 'reset',
            kind: 'initial',
            anchor: resp.anchor,
            anchorStatus: resp.anchorStatus,
            hasMoreBefore: hasMoreBeforeRef.current,
            hasMoreAfter: hasMoreAfterRef.current,
          }),
        )
        runtime.dispatch({
          type: 'bootstrap',
          mode: bootstrapMode,
          target: bootstrapTarget,
        })
        setLastEvent(
          bootstrapMode === 'restored'
            ? `restored ${feed.title}`
            : resp.messages.length > 0
              ? `loaded ${feed.title}`
              : `seeded ${feed.title}`,
        )

        await log({
          requestId,
          operation: 'feed.load',
          phase: 'success',
          feedId: activeFeedId,
          messageCount: resp.messages.length,
          details: {
            total: resp.total,
            hasMoreBefore: hasMoreBeforeRef.current,
            hasMoreAfter: hasMoreAfterRef.current,
            anchor: resp.anchor,
            anchorStatus: resp.anchorStatus,
            mode: bootstrapMode,
            restoreInput: persistedViewportAnchor,
            restoreApplied: usedPersistedViewportAnchor,
            restoreFallbackError:
              restoreResp && isErrorResponse(restoreResp)
                ? restoreResp.errorCode
                : undefined,
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
        return
      }

      if (
        event.type === 'needMoreAfter' &&
        event.feedId === activeFeedIdRef.current
      ) {
        if (loadingAfterRef.current) {
          return
        }

        // 普通向下分页也必须由 runtime 的 edge event 驱动；
        // demo 不能再用 scrollTop/scrollHeight 自己判断触底。
        void loadFutureBatch(
          downwardScrollModeRef.current === 'follow-bottom'
            ? 'follow-bottom'
            : 'edge-user',
        )
      }
    })

    return unsubscribe
  }, [loadFutureBatch, loadHistoryBatch, log, runtime])

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
    editMessage,
    deleteMessage,
    reactToMessage,
    toggleDynamicHeight,
    sendMessage,
    followBottom,
    clearFeed,
    rememberViewportAnchor,
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

function isSameViewportAnchor(
  left: PersistedViewportAnchor | undefined,
  right: PersistedViewportAnchor,
): boolean {
  return (
    left?.messageId === right.messageId &&
    left?.position === right.position &&
    left?.offsetWithinMessage === right.offsetWithinMessage
  )
}

function isErrorResponse<TMessage>(
  response: GetLatestMessagesResp<TMessage> | GetMessagesAroundResp<TMessage>,
): response is Extract<
  GetLatestMessagesResp<TMessage> | GetMessagesAroundResp<TMessage>,
  { ok: false }
> {
  return response.ok === false
}

function computeHasMoreBefore(
  feedMessages: DemoMessage[],
  loadedMessages: DemoMessage[],
): boolean {
  const feedFirst = feedMessages[0]
  const loadedFirst = loadedMessages[0]

  if (!feedFirst || !loadedFirst) {
    return false
  }

  return feedFirst.sequence < loadedFirst.sequence
}

function computeHasMoreAfter(
  feedMessages: DemoMessage[],
  loadedMessages: DemoMessage[],
): boolean {
  const feedLast = feedMessages.at(-1)
  const loadedLast = loadedMessages.at(-1)

  if (!feedLast || !loadedLast) {
    return false
  }

  return feedLast.sequence > loadedLast.sequence
}

function getEditedMessageKind(
  currentKind: DemoMessage['kind'],
  body: string,
): DemoMessage['kind'] {
  if (currentKind === 'image' || currentKind === 'video' || currentKind === 'album') {
    return currentKind
  }

  return body.length > 180 ? 'longText' : 'text'
}

function getRandomReaction(): string {
  return (
    REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)] ??
    REACTION_EMOJIS[0] ??
    '😀'
  )
}
