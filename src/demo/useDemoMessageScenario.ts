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
import type { DemoFeedRuntimeCache } from './useDemoFeedRuntimeCache'

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
    | 'history.latest'
    | 'history.around'
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
  'history.latest': 200,
  'history.around': 200,
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

type ViewportAnchorRememberReason =
  | 'scroll-idle'
  | 'transaction-settle'
  | 'before-feed-switch'
  | 'before-unmount'

type CachedFeedSessionState = {
  feedId: string
  messages: DemoMessage[]
  feedMessages: DemoMessage[]
  revision: number
  generation: number
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  lastViewportAnchor?: PersistedViewportAnchor
}

type LoadedFeedResponse = Extract<
  GetLatestMessagesResp<DemoMessage> | GetMessagesAroundResp<DemoMessage>,
  { ok: true }
>

type LoadedFeedWindow = {
  feed: DemoFeedDefinition
  normalizedFeedMessages: DemoMessage[]
  messages: DemoMessage[]
  persistedViewportAnchor?: PersistedViewportAnchor
  bootstrapMode: 'latest' | 'restored'
  bootstrapTarget?: AnchorState
  usedPersistedViewportAnchor: boolean
  restoreResp: GetMessagesAroundResp<DemoMessage> | null
  resp: LoadedFeedResponse
  persistedFeed: NonNullable<Awaited<ReturnType<typeof loadPersistedDemoFeed>>>
}

export type DemoMessageScenario = {
  feeds: DemoFeedDefinition[]
  activeFeedId: string
  selectedFeedId: string
  pendingFeedId: string | null
  activeFeed: DemoFeedDefinition
  activeRuntime: MessageViewportRuntime<DemoMessage>
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
  rememberRuntimeViewportAnchor: (
    anchor: AnchorState | null,
    reason: 'scroll-idle' | 'transaction-settle',
  ) => void
}

/**
 * Demo 场景 hook 负责模拟 IM 数据请求、feed 切换和本地持久化。
 * runtime 仍然只接收 MessageDataSnapshot 和 command，不知道 demo 的 mock 请求过程。
 */
export function useDemoMessageScenario(
  runtimeCache: DemoFeedRuntimeCache,
): DemoMessageScenario {
  const initialFeedId = DEMO_FEEDS[0]?.id ?? 'feed-runtime'
  const [activeFeedId, setActiveFeedId] = useState(initialFeedId)
  const [selectedFeedId, setSelectedFeedId] = useState(initialFeedId)
  const [pendingFeedId, setPendingFeedId] = useState<string | null>(null)
  const [messageCount, setMessageCount] = useState(0)
  const [loadedMessageCount, setLoadedMessageCount] = useState(0)
  const [loadingBefore, setLoadingBefore] = useState(false)
  const [feedLoading, setFeedLoading] = useState(true)
  const [pendingOperation, setPendingOperation] = useState('idle')
  const [lastEvent, setLastEvent] = useState(
    `loading ${getDemoFeedDefinition(initialFeedId).title}...`,
  )

  const activeFeedIdRef = useRef(activeFeedId)
  const activeRuntimeRef = useRef<MessageViewportRuntime<DemoMessage> | null>(null)
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
  const queuedLatestFollowBottomRef = useRef(false)
  const loadTokenRef = useRef(0)
  const feedSessionStateRef = useRef(new Map<string, CachedFeedSessionState>())
  const nextFeedSwitchRuntimeCacheHitRef = useRef(false)
  const stagedActivationSkipRef = useRef(new Set<string>())
  const pendingOperationCountRef = useRef(0)
  const activeOperationsRef = useRef(new Map<string, number>())

  const activeFeed = useMemo(
    () => getDemoFeedDefinition(activeFeedId),
    [activeFeedId],
  )
  const [activeRuntime, setActiveRuntime] = useState(
    () => runtimeCache.getRuntime(initialFeedId),
  )

  useEffect(() => {
    activeFeedIdRef.current = activeFeedId
  }, [activeFeedId])

  useEffect(() => {
    activeRuntimeRef.current = activeRuntime
  }, [activeRuntime])

  const log = useCallback((entry: DemoLogEntry) => writeDemoLog(entry), [])

  const syncDisplayedCounts = useCallback(() => {
    setMessageCount(feedMessagesRef.current.length)
    setLoadedMessageCount(messagesRef.current.length)
  }, [])

  const saveCurrentFeedSessionState = useCallback((feedId = activeFeedIdRef.current) => {
    feedSessionStateRef.current.set(feedId, {
      feedId,
      messages: messagesRef.current,
      feedMessages: feedMessagesRef.current,
      revision: revisionRef.current,
      generation: generationRef.current,
      hasMoreBefore: hasMoreBeforeRef.current,
      hasMoreAfter: hasMoreAfterRef.current,
      lastViewportAnchor: lastViewportAnchorRef.current,
    })
  }, [])

  const restoreFeedSessionState = useCallback((
    state: CachedFeedSessionState,
  ) => {
    messagesRef.current = state.messages
    feedMessagesRef.current = state.feedMessages
    revisionRef.current = state.revision
    generationRef.current = state.generation
    hasMoreBeforeRef.current = state.hasMoreBefore
    hasMoreAfterRef.current = state.hasMoreAfter
    lastViewportAnchorRef.current = state.lastViewportAnchor
    loadingBeforeRef.current = false
    loadingAfterRef.current = false
    feedLoadingRef.current = false
    queuedLatestFollowBottomRef.current = false
    setLoadingBefore(false)
    setFeedLoading(false)
    syncDisplayedCounts()
  }, [syncDisplayedCounts])

  const loadFeedWindow = useCallback(async (
    feedId: string,
    requestId: string,
  ): Promise<LoadedFeedWindow> => {
    const feed = getDemoFeedDefinition(feedId)

    await sleep(FEED_LOAD_DELAY_MS)

    let persistedFeed = await loadPersistedDemoFeed(feedId)

    if (!persistedFeed) {
      const seedMessages = createDemoMessages(feed.seedCount, feedId)
      persistedFeed = {
        version: 1,
        feedId,
        revision: 1,
        hasMoreBefore: true,
        lastViewportAnchor: undefined,
        messages: seedMessages,
        updatedAt: new Date().toISOString(),
      }
      await savePersistedDemoFeed(persistedFeed)
      void log({
        requestId: createDemoRequestId('feed.seed'),
        operation: 'feed.seed',
        phase: 'success',
        feedId,
        messageCount: seedMessages.length,
        details: { seedCount: feed.seedCount, parentRequestId: requestId },
      })
    }

    const normalizedFeedMessages = normalizeDemoMessages(
      feedId,
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
        feedId,
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
        feedId,
        count: PAGE_SIZE,
      })
    }

    if (persistedViewportAnchor && isErrorResponse(resp)) {
      resp = await getLatestMessages({
        feedId,
        count: PAGE_SIZE,
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

    return {
      feed,
      normalizedFeedMessages,
      messages: normalizeDemoMessages(feedId, resp.messages),
      persistedViewportAnchor,
      bootstrapMode,
      bootstrapTarget,
      usedPersistedViewportAnchor,
      restoreResp,
      resp,
      persistedFeed,
    }
  }, [log])

  const commitLoadedFeedWindow = useCallback(async ({
    feedId,
    runtime,
    requestId,
    token,
    loaded,
    activate,
  }: {
    feedId: string
    runtime: MessageViewportRuntime<DemoMessage>
    requestId: string
    token: number
    loaded: LoadedFeedWindow
    activate: boolean
  }): Promise<boolean> => {
    if (loadTokenRef.current !== token) {
      void log({
        requestId,
        operation: 'feed.load',
        phase: 'cancel',
        feedId,
        messageCount: loaded.resp.messages.length,
        details: { reason: 'stale-load' },
      })
      return false
    }

    generationRef.current += 1
    revisionRef.current += 1
    activeFeedIdRef.current = feedId
    lastViewportAnchorRef.current = loaded.usedPersistedViewportAnchor
      ? loaded.persistedViewportAnchor
      : undefined
    feedMessagesRef.current = loaded.normalizedFeedMessages
    messagesRef.current = loaded.messages
    hasMoreBeforeRef.current = computeHasMoreBefore(
      feedMessagesRef.current,
      messagesRef.current,
    )
    hasMoreAfterRef.current = computeHasMoreAfter(
      feedMessagesRef.current,
      messagesRef.current,
    )
    syncDisplayedCounts()
    saveCurrentFeedSessionState(feedId)

    if (
      loaded.persistedViewportAnchor &&
      !loaded.usedPersistedViewportAnchor
    ) {
      await savePersistedDemoFeed({
        ...loaded.persistedFeed,
        messages: loaded.normalizedFeedMessages,
        lastViewportAnchor: undefined,
        updatedAt: new Date().toISOString(),
      })
    }

    runtime.setDataSnapshot(
      createDemoSnapshot({
        feedId,
        generation: generationRef.current,
        messages: messagesRef.current,
        revision: revisionRef.current,
        effect: 'reset',
        kind: 'initial',
        anchor: loaded.resp.anchor,
        anchorStatus: loaded.resp.anchorStatus,
        hasMoreBefore: hasMoreBeforeRef.current,
        hasMoreAfter: hasMoreAfterRef.current,
      }),
    )
    runtime.dispatch({
      type: 'bootstrap',
      mode: loaded.bootstrapMode,
      target: loaded.bootstrapTarget,
    })

    if (activate) {
      stagedActivationSkipRef.current.add(feedId)
      setActiveRuntime(runtime)
      setActiveFeedId(feedId)
      setSelectedFeedId(feedId)
      setPendingFeedId(null)
    }

    setLastEvent(
      loaded.bootstrapMode === 'restored'
        ? `restored ${loaded.feed.title}`
        : loaded.resp.messages.length > 0
          ? `loaded ${loaded.feed.title}`
          : `seeded ${loaded.feed.title}`,
    )

    void log({
      requestId,
      operation: 'feed.load',
      phase: 'success',
      feedId,
      messageCount: loaded.resp.messages.length,
      details: {
        total: loaded.resp.total,
        hasMoreBefore: hasMoreBeforeRef.current,
        hasMoreAfter: hasMoreAfterRef.current,
        anchor: loaded.resp.anchor,
        anchorStatus: loaded.resp.anchorStatus,
        mode: loaded.bootstrapMode,
        restoreInput: loaded.persistedViewportAnchor,
        restoreApplied: loaded.usedPersistedViewportAnchor,
        restoreFallbackError:
          loaded.restoreResp && isErrorResponse(loaded.restoreResp)
            ? loaded.restoreResp.errorCode
            : undefined,
        activation: activate ? 'staged' : 'active',
      },
    })

    return true
  }, [log, saveCurrentFeedSessionState, syncDisplayedCounts])

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
    activeRuntime.setDataSnapshot(
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
    saveCurrentFeedSessionState()
  }, [activeRuntime, saveCurrentFeedSessionState, syncDisplayedCounts])

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

  const persistViewportAnchor = useCallback((
    runtimeAnchor: AnchorState | null,
    reason: ViewportAnchorRememberReason,
  ) => {
    if (feedLoadingRef.current || feedMessagesRef.current.length === 0) {
      return
    }

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
  }, [log])

  const rememberViewportAnchor = useCallback((
    reason: 'before-feed-switch' | 'before-unmount',
  ) => {
    persistViewportAnchor(activeRuntime.getViewportAnchorState(), reason)
  }, [activeRuntime, persistViewportAnchor])

  const rememberRuntimeViewportAnchor = useCallback((
    anchor: AnchorState | null,
    reason: 'scroll-idle' | 'transaction-settle',
  ) => {
    persistViewportAnchor(anchor, reason)
  }, [persistViewportAnchor])

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

  const finishAfterDataRequest = useCallback((requestFeedId: string) => {
    loadingAfterRef.current = false

    if (!queuedLatestFollowBottomRef.current) {
      return
    }

    queuedLatestFollowBottomRef.current = false

    if (activeFeedIdRef.current !== requestFeedId) {
      return
    }

    activeRuntimeRef.current?.dispatch({ type: 'followBottom' })
  }, [])

  const loadFutureBatch = useCallback((
    source: 'edge-user',
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
        finishAfterDataRequest(requestFeedId)
      },
      skipPersist: true,
    })
  }, [finishAfterDataRequest, log, runLoggedOperation])

  const loadLatestWindow = useCallback((source: 'follow-bottom') => {
    if (loadingAfterRef.current) {
      queuedLatestFollowBottomRef.current = true
      void log({
        requestId: createDemoRequestId('history.latest'),
        operation: 'history.latest',
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
      operation: 'history.latest',
      startEvent: 'loading latest messages...',
      details: { batchSize: PAGE_SIZE, source },
      apply: async (feedId) => {
        const storeFeed = await loadPersistedDemoFeed(feedId)
        feedMessagesRef.current = storeFeed
          ? normalizeDemoMessages(feedId, storeFeed.messages)
          : []

        const resp = await getLatestMessages({
          feedId,
          count: PAGE_SIZE,
        })

        if (isErrorResponse(resp)) {
          throw new Error(resp.errorMessage)
        }

        messagesRef.current = normalizeDemoMessages(feedId, resp.messages)
        hasMoreBeforeRef.current = resp.hasMoreBefore
        hasMoreAfterRef.current = resp.hasMoreAfter
        lastViewportAnchorRef.current = undefined

        return {
          effect: 'auto-scroll-to-bottom' as ViewportEffect,
          kind: 'reset' as DemoSnapshotKind,
          eventText: `loaded latest ${messagesRef.current.length} messages`,
          details: {
            total: resp.total,
            source,
            hasMoreBefore: resp.hasMoreBefore,
            hasMoreAfter: resp.hasMoreAfter,
            loaded: messagesRef.current.length,
            anchor: resp.anchor,
          },
        }
      },
      onFinally: () => {
        finishAfterDataRequest(requestFeedId)
      },
    })
  }, [finishAfterDataRequest, log, runLoggedOperation])

  const loadAroundTargetWindow = useCallback((
    target: { messageId: string; position?: number },
    reason: 'jump' | 'restore',
  ) => {
    if (loadingAfterRef.current) {
      void log({
        requestId: createDemoRequestId('history.around'),
        operation: 'history.around',
        phase: 'skip',
        feedId: activeFeedIdRef.current,
        messageCount: messagesRef.current.length,
        details: { reason: 'already-loading', target, intent: reason },
      })
      return
    }

    loadingAfterRef.current = true
    const requestFeedId = activeFeedIdRef.current

    void runLoggedOperation({
      operation: 'history.around',
      startEvent: 'loading target messages...',
      details: {
        intent: reason,
        target,
        before: RESTORE_BEFORE_PAGE_SIZE,
        after: RESTORE_AFTER_PAGE_SIZE,
      },
      apply: async (feedId) => {
        const storeFeed = await loadPersistedDemoFeed(feedId)
        feedMessagesRef.current = storeFeed
          ? normalizeDemoMessages(feedId, storeFeed.messages)
          : []

        const resp = await getMessagesAround({
          feedId,
          anchor: target,
          before: RESTORE_BEFORE_PAGE_SIZE,
          after: RESTORE_AFTER_PAGE_SIZE,
        })

        if (isErrorResponse(resp)) {
          throw new Error(resp.errorMessage)
        }

        messagesRef.current = normalizeDemoMessages(feedId, resp.messages)
        hasMoreBeforeRef.current = resp.hasMoreBefore
        hasMoreAfterRef.current = resp.hasMoreAfter

        return {
          effect: 'reset' as ViewportEffect,
          kind: 'reset' as DemoSnapshotKind,
          eventText: `loaded ${reason} target`,
          details: {
            total: resp.total,
            intent: reason,
            target,
            hasMoreBefore: resp.hasMoreBefore,
            hasMoreAfter: resp.hasMoreAfter,
            loaded: messagesRef.current.length,
            anchor: resp.anchor,
            anchorStatus: resp.anchorStatus,
          },
        }
      },
      onFinally: () => {
        finishAfterDataRequest(requestFeedId)
      },
      skipPersist: true,
    })
  }, [finishAfterDataRequest, log, runLoggedOperation])

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
          count: PAGE_SIZE,
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
    activeRuntime.dispatch({ type: 'followBottom' })
  }, [activeRuntime, log])

  const selectFeed = useCallback((feedId: string) => {
    if (feedId === selectedFeedId) {
      return
    }

    const previousFeedId = activeFeedIdRef.current
    const previousMessageCount = messagesRef.current.length
    const feed = getDemoFeedDefinition(feedId)
    const feedLoadRequestId = createDemoRequestId('feed.load')

    rememberViewportAnchor('before-feed-switch')
    saveCurrentFeedSessionState()
    setSelectedFeedId(feedId)

    const cachedState = feedSessionStateRef.current.get(feedId)
    const runtimeCacheHit = runtimeCache.hasRuntime(feedId) && !!cachedState
    const nextRuntime = runtimeCache.getRuntime(feedId)
    nextFeedSwitchRuntimeCacheHitRef.current = runtimeCacheHit

    if (runtimeCacheHit && cachedState) {
      activeFeedIdRef.current = feedId
      restoreFeedSessionState(cachedState)
    }

    void log({
      requestId: createDemoRequestId('feed.select'),
      operation: 'feed.select',
      phase: 'start',
      feedId: previousFeedId,
      messageCount: previousMessageCount,
      details: { nextFeedId: feedId, runtimeCacheHit },
    })

    const token = loadTokenRef.current + 1

    loadTokenRef.current = token

    if (runtimeCacheHit) {
      setPendingFeedId(null)
      stagedActivationSkipRef.current.add(feedId)
      setLastEvent(`restored cached ${feed.title}`)
      setActiveRuntime(nextRuntime)
      setActiveFeedId(feedId)
      return
    }
    feedLoadingRef.current = true
    setPendingFeedId(feedId)
    setFeedLoading(true)
    setLastEvent(`loading ${feed.title}...`)
    void log({
      requestId: feedLoadRequestId,
      operation: 'feed.load',
      phase: 'start',
      feedId,
      messageCount: previousMessageCount,
      details: { title: feed.title, activation: 'deferred' },
    })

    void (async () => {
      try {
        const loaded = await loadFeedWindow(feedId, feedLoadRequestId)
        await commitLoadedFeedWindow({
          feedId,
          runtime: nextRuntime,
          requestId: feedLoadRequestId,
          token,
          loaded,
          activate: true,
        })
      } catch (error) {
        if (loadTokenRef.current !== token) {
          void log({
            requestId: feedLoadRequestId,
            operation: 'feed.load',
            phase: 'cancel',
            feedId,
            details: { reason: 'stale-load-before-data' },
          })
          return
        }

        setSelectedFeedId(activeFeedIdRef.current)
        setLastEvent('feed load failed')
        void log({
          requestId: feedLoadRequestId,
          operation: 'feed.load',
          phase: 'error',
          feedId,
          error: getErrorMessage(error),
        })
      } finally {
        if (loadTokenRef.current === token) {
          feedLoadingRef.current = false
          setFeedLoading(false)
          setPendingFeedId(null)
        }
      }
    })()
  }, [
    commitLoadedFeedWindow,
    loadFeedWindow,
    log,
    rememberViewportAnchor,
    restoreFeedSessionState,
    runtimeCache,
    saveCurrentFeedSessionState,
    selectedFeedId,
  ])

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
          queuedLatestFollowBottomRef.current = false
          feedMessagesRef.current = []
          messagesRef.current = []
          syncDisplayedCounts()
          activeRuntime.setDataSnapshot(
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
          activeRuntime.dispatch({ type: 'bootstrap', mode: 'latest' })
          saveCurrentFeedSessionState(feedId)
        } else {
          feedSessionStateRef.current.delete(feedId)
          runtimeCache.deleteRuntime(feedId)
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
  }, [
    activeRuntime,
    beginPendingOperation,
    endPendingOperation,
    log,
    runtimeCache,
    saveCurrentFeedSessionState,
    syncDisplayedCounts,
  ])

  useEffect(() => {
    return () => {
      const runtime = activeRuntimeRef.current

      if (runtime) {
        persistViewportAnchor(runtime.getViewportAnchorState(), 'before-unmount')
      }

      saveCurrentFeedSessionState()
    }
  }, [persistViewportAnchor, saveCurrentFeedSessionState])

  useEffect(() => {
    const feed = getDemoFeedDefinition(activeFeedId)
    const requestId = createDemoRequestId('feed.load')
    const runtimeCacheHit = nextFeedSwitchRuntimeCacheHitRef.current
    const stagedActivationSkip = stagedActivationSkipRef.current.delete(activeFeedId)

    nextFeedSwitchRuntimeCacheHitRef.current = false
    activeFeedIdRef.current = activeFeedId
    queuedLatestFollowBottomRef.current = false

    if (runtimeCacheHit) {
      feedLoadingRef.current = false
      setFeedLoading(false)
      void log({
        requestId,
        operation: 'feed.load',
        phase: 'skip',
        feedId: activeFeedId,
        messageCount: messagesRef.current.length,
        details: { title: feed.title, reason: 'runtime-cache-hit' },
      })
      return
    }

    if (stagedActivationSkip) {
      return
    }

    const token = loadTokenRef.current + 1

    loadTokenRef.current = token

    feedLoadingRef.current = true
    setFeedLoading(true)

    async function loadFeed(): Promise<void> {
      void log({
        requestId,
        operation: 'feed.load',
        phase: 'start',
        feedId: activeFeedId,
        messageCount: messagesRef.current.length,
        details: { title: feed.title },
      })

      try {
        const loaded = await loadFeedWindow(activeFeedId, requestId)

        if (loadTokenRef.current !== token) {
          void log({
            requestId,
            operation: 'feed.load',
            phase: 'cancel',
            feedId: activeFeedId,
            messageCount: loaded.resp.messages.length,
            details: { reason: 'stale-load' },
          })
          return
        }

        await commitLoadedFeedWindow({
          feedId: activeFeedId,
          runtime: activeRuntime,
          requestId,
          token,
          loaded,
          activate: false,
        })
      } catch (error) {
        if (loadTokenRef.current !== token) {
          void log({
            requestId,
            operation: 'feed.load',
            phase: 'cancel',
            feedId: activeFeedId,
            details: { reason: 'stale-load-before-data' },
          })
          return
        }

        setLastEvent('feed load failed')
        void log({
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
  }, [
    activeFeedId,
    activeRuntime,
    commitLoadedFeedWindow,
    loadFeedWindow,
    log,
  ])

  useEffect(() => {
    const unsubscribe = activeRuntime.subscribeEvent((event) => {
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
        void loadFutureBatch('edge-user')
        return
      }

      if (
        event.type === 'needLatestMessages' &&
        event.feedId === activeFeedIdRef.current
      ) {
        void loadLatestWindow('follow-bottom')
        return
      }

      if (
        event.type === 'needMessagesAround' &&
        event.feedId === activeFeedIdRef.current
      ) {
        void loadAroundTargetWindow(event.target, event.reason)
      }
    })

    return unsubscribe
  }, [
    activeRuntime,
    loadAroundTargetWindow,
    loadFutureBatch,
    loadHistoryBatch,
    loadLatestWindow,
    log,
  ])

  return {
    feeds: DEMO_FEEDS,
    activeFeedId,
    selectedFeedId,
    pendingFeedId,
    activeFeed,
    activeRuntime,
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
    rememberRuntimeViewportAnchor,
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
