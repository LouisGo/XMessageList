import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DEFAULT_VIEWPORT_COMPACTION_SPACER_THRESHOLD_PX } from '../runtime'
import type {
  AnchorState,
  MessageDataSnapshot,
  MessageViewportRuntime,
  ViewportAnchorChangedEvent,
} from '../runtime'
import {
  type DemoViewportEffect,
  type DemoMessage,
  createDemoIdentityRemapSnapshot,
  createDemoMessages,
  createDemoSnapshot,
  createDemoSnapshotFromItems,
  createNewestMessage,
  createOptimisticOutgoingItem,
  createOutgoingMessage,
  createOutgoingIdentityRemap,
  getNextMessageSequence,
  normalizeDemoMessages,
  toCommittedItem,
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
  type AdvancedMockEventStormState,
  type AdvancedMockPublishResult,
  applyBotPushTick,
  applyEventStormTick,
  createEventStormState,
  flushEventStormBuffer,
  getNextBotPushDelayMs,
  getNextEventStormDelayMs,
} from './demoAdvancedMockScenarios'
import {
  createDemoRequestId,
  type DemoLogEntry,
  type DemoOperationName,
  loadPersistedDemoFeed,
  type PersistedDemoFeed,
  type PersistedViewportAnchor,
  savePersistedDemoFeed,
  writeDemoLog,
} from './demoLocalStoreClient'
import type { DemoFeedRuntimeCache } from './useDemoFeedRuntimeCache'

const PAGE_SIZE = 20
const FEED_LOAD_DELAY_MS = 180
const RESTORE_BEFORE_PAGE_SIZE = Math.max(1, Math.floor(PAGE_SIZE / 2))
const RESTORE_AFTER_PAGE_SIZE = PAGE_SIZE
const JUMP_AROUND_BEFORE_PAGE_SIZE = PAGE_SIZE
const JUMP_AROUND_AFTER_PAGE_SIZE = PAGE_SIZE
const VIEWPORT_COMPACTION_BEFORE_PAGE_SIZE = PAGE_SIZE
const VIEWPORT_COMPACTION_AFTER_PAGE_SIZE = PAGE_SIZE
const JUMP_HIGHLIGHT_DURATION_MS = 1_400
const DESTINATION_REBUILD_SPACER_THRESHOLD_PX =
  DEFAULT_VIEWPORT_COMPACTION_SPACER_THRESHOLD_PX
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
  'history.prepend': 30,
  'history.append': 30,
  'history.latest': 40,
  'history.around': 60,
  'message.append': 50,
  'message.longBurst': 620,
  'message.edit': 50,
  'message.delete': 90,
  'message.react': 20,
  'message.resize': 200,
  'message.send': 60,
  'feed.clear': 220,
}

type DemoSnapshotKind = MessageDataSnapshot['change']['kind']
type AroundTargetReason = 'jump' | 'restore' | 'viewport-compaction'
type AroundTargetLoader = (
  target: { messageId: string; position?: number },
  reason: AroundTargetReason,
) => void

type LoggedOperationResult = {
  effect: DemoViewportEffect
  kind: DemoSnapshotKind
  anchor?: MessageDataSnapshot['anchor']
  anchorStatus?: MessageDataSnapshot['anchorStatus']
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

function shouldRebuildRuntimeForDestination(
  runtime: MessageViewportRuntime<DemoMessage>,
): boolean {
  const snapshot = runtime.getSnapshot()
  return (
    snapshot.topSpacer > DESTINATION_REBUILD_SPACER_THRESHOLD_PX ||
    snapshot.bottomSpacer > DESTINATION_REBUILD_SPACER_THRESHOLD_PX
  )
}

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

export type DemoMessageScenarioStorage = {
  loadPersistedDemoFeed: (feedId: string) => Promise<PersistedDemoFeed | null>
  savePersistedDemoFeed: (feed: PersistedDemoFeed) => Promise<void>
  writeDemoLog: (entry: DemoLogEntry) => Promise<void>
}

export type DemoMessageScenarioApi = {
  getLatestMessages: typeof getLatestMessages
  getMessagesAround: typeof getMessagesAround
}

export type DemoMessageScenarioFaults = {
  sendFailureMode?: 'fail-first-and-retry-succeeds'
}

export type DemoMessageScenarioOptions = {
  api?: DemoMessageScenarioApi
  storage?: DemoMessageScenarioStorage
  faults?: DemoMessageScenarioFaults
}

const DEFAULT_DEMO_MESSAGE_SCENARIO_API: DemoMessageScenarioApi = {
  getLatestMessages,
  getMessagesAround,
}

const DEFAULT_DEMO_MESSAGE_SCENARIO_STORAGE: DemoMessageScenarioStorage = {
  loadPersistedDemoFeed,
  savePersistedDemoFeed,
  writeDemoLog,
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
  loadHistoryBatch: (source?: 'manual' | 'auto') => void
  loadFutureBatch: (source?: 'edge-user') => void
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
  followBottom: (source: 'sidebar' | 'floating') => void
  jumpToQuote: (input: {
    origin: { messageId: string; position?: number }
    target: { messageId: string; position?: number }
  }) => void
  clearFeed: (feedId: string) => void
  rememberRuntimeViewportAnchor: (event: ViewportAnchorChangedEvent) => void
}

/**
 * Demo 场景 hook 负责模拟 IM 数据请求、feed 切换和本地持久化。
 * runtime 仍然只接收 MessageDataSnapshot 和 command，不知道 demo 的 mock 请求过程。
 */
export function useDemoMessageScenario(
  runtimeCache: DemoFeedRuntimeCache,
  options: DemoMessageScenarioOptions = {},
): DemoMessageScenario {
  const api = options.api ?? DEFAULT_DEMO_MESSAGE_SCENARIO_API
  const storage = options.storage ?? DEFAULT_DEMO_MESSAGE_SCENARIO_STORAGE
  const initialFeedId = DEMO_FEEDS[0]?.id ?? 'feed-runtime'
  const [activeFeedId, setActiveFeedId] = useState(initialFeedId)
  const [selectedFeedId, setSelectedFeedId] = useState(initialFeedId)
  const [pendingFeedId, setPendingFeedId] = useState<string | null>(null)
  const [messageCount, setMessageCount] = useState(0)
  const [loadedMessageCount, setLoadedMessageCount] = useState(0)
  const [hasMoreBefore, setHasMoreBefore] = useState(false)
  const [hasMoreAfter, setHasMoreAfter] = useState(false)
  const [loadingBefore, setLoadingBefore] = useState(false)
  const [loadingAfter, setLoadingAfter] = useState(false)
  const [feedLoading, setFeedLoading] = useState(true)
  const [eventStormRunning, setEventStormRunning] = useState(false)
  const [botPushActive, setBotPushActive] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(
    null,
  )
  const [highlightToken, setHighlightToken] = useState(0)
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
  const queuedAroundTargetRef = useRef<{
    target: { messageId: string; position?: number }
    reason: AroundTargetReason
  } | null>(null)
  const loadAroundTargetWindowRef = useRef<AroundTargetLoader | null>(null)
  const loadTokenRef = useRef(0)
  const feedSessionStateRef = useRef(new Map<string, CachedFeedSessionState>())
  const nextFeedSwitchRuntimeCacheHitRef = useRef(false)
  const stagedActivationSkipRef = useRef(new Set<string>())
  const pendingOperationCountRef = useRef(0)
  const activeOperationsRef = useRef(new Map<string, number>())
  const eventStormRunningRef = useRef(false)
  const eventStormTimerRef = useRef<number | null>(null)
  const eventStormTokenRef = useRef(0)
  const eventStormStateRef = useRef<AdvancedMockEventStormState | null>(null)
  const botPushActiveRef = useRef(false)
  const botPushTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const sendFailureConsumedRef = useRef(false)
  const failedOptimisticSendRef = useRef<{
    feedId: string
    clientMessageId: string
    body: string
  } | null>(null)

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

  useEffect(() => () => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
  }, [])

  const log = useCallback(
    (entry: DemoLogEntry) => storage.writeDemoLog(entry),
    [storage],
  )

  const syncDisplayedCounts = useCallback(() => {
    setMessageCount(feedMessagesRef.current.length)
    setLoadedMessageCount(messagesRef.current.length)
    setHasMoreBefore(hasMoreBeforeRef.current)
    setHasMoreAfter(hasMoreAfterRef.current)
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
    queuedAroundTargetRef.current = null
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

    let persistedFeed = await storage.loadPersistedDemoFeed(feedId)

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
      await storage.savePersistedDemoFeed(persistedFeed)
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
      restoreResp = await api.getMessagesAround({
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
      resp = await api.getLatestMessages({
        feedId,
        count: PAGE_SIZE,
      })
    }

    if (persistedViewportAnchor && isErrorResponse(resp)) {
      resp = await api.getLatestMessages({
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
  }, [api, log, storage])

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
      await storage.savePersistedDemoFeed({
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
  }, [log, saveCurrentFeedSessionState, storage, syncDisplayedCounts])

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
    effect: DemoViewportEffect,
    kind: DemoSnapshotKind,
    snapshotMeta: Pick<MessageDataSnapshot, 'anchor' | 'anchorStatus'> = {},
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
    activeRuntimeRef.current?.setDataSnapshot(
      createDemoSnapshot({
        feedId: activeFeedIdRef.current,
        generation: generationRef.current,
        messages: messagesRef.current,
        revision: revisionRef.current,
        effect,
        kind,
        anchor: snapshotMeta.anchor,
        anchorStatus: snapshotMeta.anchorStatus,
        hasMoreBefore: hasMoreBeforeRef.current,
        hasMoreAfter: hasMoreAfterRef.current,
      }),
    )
    saveCurrentFeedSessionState()
  }, [saveCurrentFeedSessionState, syncDisplayedCounts])

  const persistCurrentFeed = useCallback(async () => {
    await storage.savePersistedDemoFeed({
      version: 1,
      feedId: activeFeedIdRef.current,
      revision: revisionRef.current,
      hasMoreBefore: hasMoreBeforeRef.current,
      lastViewportAnchor: lastViewportAnchorRef.current,
      messages: feedMessagesRef.current,
      updatedAt: new Date().toISOString(),
    })
  }, [storage])

  const persistViewportAnchor = useCallback((
    event: ViewportAnchorChangedEvent,
  ) => {
    const { anchor: runtimeAnchor, feedId, generation, reason } = event
    const isActiveFeed = feedId === activeFeedIdRef.current
    const cachedState = isActiveFeed
      ? undefined
      : feedSessionStateRef.current.get(feedId)
    const messages = isActiveFeed ? messagesRef.current : cachedState?.messages
    const feedMessages = isActiveFeed
      ? feedMessagesRef.current
      : cachedState?.feedMessages
    const revision = isActiveFeed ? revisionRef.current : cachedState?.revision
    const stateGeneration = isActiveFeed
      ? generationRef.current
      : cachedState?.generation
    const hasMoreBefore = isActiveFeed
      ? hasMoreBeforeRef.current
      : cachedState?.hasMoreBefore
    const previousAnchor = isActiveFeed
      ? lastViewportAnchorRef.current
      : cachedState?.lastViewportAnchor

    if (isActiveFeed && feedLoadingRef.current && reason !== 'detach') {
      return
    }

    if (
      !messages ||
      !feedMessages ||
      feedMessages.length === 0 ||
      revision === undefined ||
      stateGeneration === undefined ||
      hasMoreBefore === undefined ||
      stateGeneration !== generation
    ) {
      return
    }

    if (!runtimeAnchor) {
      return
    }

    const { key } = runtimeAnchor

    if (key.kind !== 'committed') {
      return
    }

    const anchorMessage = feedMessages.find(
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

    if (isSameViewportAnchor(previousAnchor, nextAnchor)) {
      return
    }

    if (isActiveFeed) {
      lastViewportAnchorRef.current = nextAnchor
      saveCurrentFeedSessionState(feedId)
    } else if (cachedState) {
      feedSessionStateRef.current.set(feedId, {
        ...cachedState,
        lastViewportAnchor: nextAnchor,
      })
    }

    void storage.savePersistedDemoFeed({
      version: 1,
      feedId,
      revision,
      hasMoreBefore,
      lastViewportAnchor: nextAnchor,
      messages: feedMessages,
      updatedAt: new Date().toISOString(),
    })

    void log({
      requestId: createDemoRequestId('runtime.event'),
      operation: 'runtime.event',
      phase: 'info',
      feedId,
      messageCount: messages.length,
      details: {
        type: 'viewportAnchorRemembered',
        reason,
        generation,
        anchor: nextAnchor,
      },
    })
  }, [log, saveCurrentFeedSessionState, storage])

  const rememberRuntimeViewportAnchor = useCallback((
    event: ViewportAnchorChangedEvent,
  ) => {
    persistViewportAnchor(event)
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

      if (activeFeedIdRef.current !== feedId) {
        await log({
          requestId,
          operation: input.operation,
          phase: 'cancel',
          feedId,
          messageCount: messagesRef.current.length,
          details: { reason: 'feed-switched-after-apply' },
        })
        return
      }

      publishCurrentMessages(result.effect, result.kind, {
        anchor: result.anchor,
        anchorStatus: result.anchorStatus,
      })

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
      if (error instanceof DemoOperationCancelled) {
        setLastEvent(`${input.operation} cancelled`)
        await log({
          requestId,
          operation: input.operation,
          phase: 'cancel',
          feedId,
          messageCount: messagesRef.current.length,
          details: { reason: error.reason },
        })
        return
      }

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

  const clearEventStormTimer = useCallback(() => {
    if (eventStormTimerRef.current === null) {
      return
    }

    window.clearTimeout(eventStormTimerRef.current)
    eventStormTimerRef.current = null
  }, [])

  const clearBotPushTimer = useCallback(() => {
    if (botPushTimerRef.current === null) {
      return
    }

    window.clearTimeout(botPushTimerRef.current)
    botPushTimerRef.current = null
  }, [])

  const highlightJumpTarget = useCallback((messageId: string) => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }

    setHighlightedMessageId(messageId)
    setHighlightToken((token) => token + 1)
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null)
      highlightTimerRef.current = null
    }, JUMP_HIGHLIGHT_DURATION_MS)
  }, [])

  const logAdvancedMockOperationSummary = useCallback((
    source: 'mock.eventStorm' | 'mock.botPush',
    result: AdvancedMockPublishResult,
  ) => {
    const emitOperationLog = (
      operation: Extract<
        DemoOperationName,
        | 'message.append'
        | 'message.react'
        | 'message.edit'
        | 'message.delete'
      >,
      count: number,
      details: Record<string, unknown>,
    ) => {
      if (count <= 0) {
        return
      }

      void log({
        requestId: createDemoRequestId(operation),
        operation,
        phase: 'success',
        feedId: activeFeedIdRef.current,
        messageCount: messagesRef.current.length,
        details: {
          source,
          count,
          eventText: result.eventText,
          viewportModifier: result.effect,
          viewportEffect: result.effect,
          snapshotKind: result.kind,
          ...details,
        },
      })
    }

    if (source === 'mock.botPush') {
      emitOperationLog('message.append', readNumberDetail(result, 'added'), {
        ids: result.details.ids,
        visibleInCurrentWindow: result.details.visibleInCurrentWindow,
      })
      return
    }

    emitOperationLog('message.append', readNumberDetail(result, 'append'), {
      visibleTailAppendCount: result.details.visibleTailAppendCount,
      visibleOutOfOrderAppendCount: result.details.visibleOutOfOrderAppendCount,
      feedOnlyChangeCount: result.details.feedOnlyChangeCount,
      buffered: result.details.buffered,
      counters: result.details.counters,
    })
    emitOperationLog('message.react', readNumberDetail(result, 'reaction'), {
      visiblePatchCount: result.details.visiblePatchCount,
      counters: result.details.counters,
    })
    emitOperationLog('message.edit', readNumberDetail(result, 'edit'), {
      visiblePatchCount: result.details.visiblePatchCount,
      counters: result.details.counters,
    })
    emitOperationLog('message.delete', readNumberDetail(result, 'delete'), {
      visibleDeleteCount: result.details.visibleDeleteCount,
      counters: result.details.counters,
    })
  }, [log])

  const publishAdvancedMockResult = useCallback((
    result: AdvancedMockPublishResult,
    source: 'mock.eventStorm' | 'mock.botPush',
  ) => {
    feedMessagesRef.current = result.feedMessages
    messagesRef.current = result.messages
    publishCurrentMessages(result.effect, result.kind)
    logAdvancedMockOperationSummary(source, result)
    void persistCurrentFeed()
  }, [
    logAdvancedMockOperationSummary,
    persistCurrentFeed,
    publishCurrentMessages,
  ])

  const finishEventStorm = useCallback((
    phase: Extract<DemoLogEntry['phase'], 'success' | 'cancel' | 'error'>,
    details: Record<string, unknown>,
  ) => {
    const wasRunning = eventStormRunningRef.current

    clearEventStormTimer()
    eventStormRunningRef.current = false
    eventStormStateRef.current = null
    setEventStormRunning(false)

    if (wasRunning) {
      endPendingOperation('mock.eventStorm')
    }

    setLastEvent(
      phase === 'success'
        ? 'event storm stopped'
        : phase === 'cancel'
          ? 'event storm cancelled'
          : 'event storm failed',
    )

    void log({
      requestId: createDemoRequestId('mock.eventStorm'),
      operation: 'mock.eventStorm',
      phase,
      feedId: activeFeedIdRef.current,
      messageCount: messagesRef.current.length,
      details,
    })
  }, [clearEventStormTimer, endPendingOperation, log])

  const toggleEventStorm = useCallback(() => {
    const feedId = activeFeedIdRef.current

    if (eventStormRunningRef.current) {
      const state = eventStormStateRef.current

      if (state) {
        const flushResult = flushEventStormBuffer({
          feedId,
          feedMessages: feedMessagesRef.current,
          messages: messagesRef.current,
          hasMoreAfter: hasMoreAfterRef.current,
          state,
        })

        if (flushResult) {
          publishAdvancedMockResult(flushResult, 'mock.eventStorm')
          void log({
            requestId: createDemoRequestId('mock.eventStorm'),
            operation: 'mock.eventStorm',
            phase: 'info',
            feedId,
            messageCount: messagesRef.current.length,
            details: flushResult.details,
          })
        }
      }

      finishEventStorm('success', {
        reason: 'toggle-off',
        counters: state ? { ...state.counters } : undefined,
        total: feedMessagesRef.current.length,
        loaded: messagesRef.current.length,
      })
      void log({
        requestId: createDemoRequestId('mock.eventStorm'),
        operation: 'mock.eventStorm',
        phase: 'info',
        feedId,
        messageCount: messagesRef.current.length,
        details: { reason: 'toggle-off' },
      })
      return
    }

    if (feedLoadingRef.current) {
      setLastEvent('wait for feed before starting event storm')
      void log({
        requestId: createDemoRequestId('mock.eventStorm'),
        operation: 'mock.eventStorm',
        phase: 'skip',
        feedId,
        messageCount: messagesRef.current.length,
        details: { reason: 'feed-loading' },
      })
      return
    }

    const token = eventStormTokenRef.current + 1

    eventStormTokenRef.current = token
    eventStormStateRef.current = createEventStormState(feedMessagesRef.current)
    eventStormRunningRef.current = true
    setEventStormRunning(true)
    beginPendingOperation('mock.eventStorm')
    setLastEvent('event storm started')

    void log({
      requestId: createDemoRequestId('mock.eventStorm'),
      operation: 'mock.eventStorm',
      phase: 'start',
      feedId,
      messageCount: messagesRef.current.length,
      details: {
        mode: 'toggle',
        loaded: messagesRef.current.length,
        total: feedMessagesRef.current.length,
      },
    })

    const runTick = () => {
      if (
        !eventStormRunningRef.current ||
        eventStormTokenRef.current !== token
      ) {
        return
      }

      if (activeFeedIdRef.current !== feedId) {
        finishEventStorm('cancel', {
          reason: 'feed-switched',
          startedFeedId: feedId,
          activeFeedId: activeFeedIdRef.current,
        })
        return
      }

      if (feedLoadingRef.current) {
        finishEventStorm('cancel', { reason: 'feed-loading', feedId })
        return
      }

      const state = eventStormStateRef.current

      if (!state) {
        finishEventStorm('error', { reason: 'missing-storm-state', feedId })
        return
      }

      const result = applyEventStormTick({
        feedId,
        feedMessages: feedMessagesRef.current,
        messages: messagesRef.current,
        hasMoreAfter: hasMoreAfterRef.current,
        state,
      })

      if (result) {
        publishAdvancedMockResult(result, 'mock.eventStorm')
        setLastEvent(result.eventText)
        void log({
          requestId: createDemoRequestId('mock.eventStorm'),
          operation: 'mock.eventStorm',
          phase: 'info',
          feedId,
          messageCount: messagesRef.current.length,
          details: result.details,
        })
      }

      eventStormTimerRef.current = window.setTimeout(
        runTick,
        getNextEventStormDelayMs(),
      )
    }

    eventStormTimerRef.current = window.setTimeout(runTick, 80)
  }, [
    beginPendingOperation,
    finishEventStorm,
    log,
    publishAdvancedMockResult,
  ])

  const publishBotPushTick = useCallback(() => {
    if (feedLoadingRef.current) {
      void log({
        requestId: createDemoRequestId('mock.botPush'),
        operation: 'mock.botPush',
        phase: 'skip',
        feedId: activeFeedIdRef.current,
        messageCount: messagesRef.current.length,
        details: { reason: 'feed-loading' },
      })
      return
    }

    const feedId = activeFeedIdRef.current
    const result = applyBotPushTick({
      feedId,
      feedMessages: feedMessagesRef.current,
      messages: messagesRef.current,
      hasMoreAfter: hasMoreAfterRef.current,
    })

    publishAdvancedMockResult(result, 'mock.botPush')
    setLastEvent(result.eventText)
    void log({
      requestId: createDemoRequestId('mock.botPush'),
      operation: 'mock.botPush',
      phase: 'info',
      feedId,
      messageCount: messagesRef.current.length,
      details: result.details,
    })
  }, [log, publishAdvancedMockResult])

  const toggleBotPush = useCallback(() => {
    const feedId = activeFeedIdRef.current

    if (botPushActiveRef.current) {
      clearBotPushTimer()
      botPushActiveRef.current = false
      setBotPushActive(false)
      endPendingOperation('mock.botPush')
      setLastEvent('bot push stopped')
      void log({
        requestId: createDemoRequestId('mock.botPush'),
        operation: 'mock.botPush',
        phase: 'success',
        feedId,
        messageCount: messagesRef.current.length,
        details: { reason: 'toggle-off' },
      })
      return
    }

    if (feedLoadingRef.current) {
      setLastEvent('wait for feed before starting bot push')
      void log({
        requestId: createDemoRequestId('mock.botPush'),
        operation: 'mock.botPush',
        phase: 'skip',
        feedId,
        messageCount: messagesRef.current.length,
        details: { reason: 'feed-loading' },
      })
      return
    }

    const scheduleNextTick = () => {
      botPushTimerRef.current = window.setTimeout(() => {
        botPushTimerRef.current = null

        if (!botPushActiveRef.current) {
          return
        }

        publishBotPushTick()
        scheduleNextTick()
      }, getNextBotPushDelayMs())
    }

    botPushActiveRef.current = true
    setBotPushActive(true)
    beginPendingOperation('mock.botPush')
    setLastEvent('bot push started')
    void log({
      requestId: createDemoRequestId('mock.botPush'),
      operation: 'mock.botPush',
      phase: 'start',
      feedId,
      messageCount: messagesRef.current.length,
      details: { source: 'button' },
    })

    publishBotPushTick()
    scheduleNextTick()
  }, [
    beginPendingOperation,
    clearBotPushTimer,
    endPendingOperation,
    log,
    publishBotPushTick,
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
        const storeFeed = await storage.loadPersistedDemoFeed(feedId)
        const storeMessages = storeFeed
          ? normalizeDemoMessages(feedId, storeFeed.messages)
          : []

        const oldestViewportMsg = messagesRef.current[0]
        if (!oldestViewportMsg) {
          return {
            effect: 'none' as DemoViewportEffect,
            kind: 'patch' as DemoSnapshotKind,
            eventText: 'no messages in viewport',
          }
        }

        const resp = await api.getMessagesAround({
          feedId,
          anchor: { messageId: oldestViewportMsg.id },
          before: PAGE_SIZE,
          after: 0,
        })

        if (isErrorResponse(resp)) {
          throw new Error(resp.errorMessage)
        }

        if (activeFeedIdRef.current !== feedId) {
          throw new DemoOperationCancelled('feed-switched')
        }

        feedMessagesRef.current = storeMessages
        // BFF 返回 anchor 之前的消息，前端与当前视口合并
        const olderInView = resp.messages.filter(
          (message) => message.id !== oldestViewportMsg.id,
        )
        messagesRef.current = [...olderInView, ...messagesRef.current]
        // 是否还能继续向上分页只能信任 BFF；不能再做“非空 feed 就还有历史”的本地推断。
        hasMoreBeforeRef.current = resp.hasMoreBefore

        return {
          effect: 'prepend' as DemoViewportEffect,
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
  }, [api, log, runLoggedOperation, storage])

  const finishAfterDataRequest = useCallback((requestFeedId: string) => {
    loadingAfterRef.current = false
    setLoadingAfter(false)

    if (queuedAroundTargetRef.current) {
      const queued = queuedAroundTargetRef.current
      const loadAroundTargetWindow = loadAroundTargetWindowRef.current
      queuedAroundTargetRef.current = null

      if (
        !loadAroundTargetWindow ||
        activeFeedIdRef.current !== requestFeedId
      ) {
        return
      }

      loadAroundTargetWindow(queued.target, queued.reason)
      return
    }

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
    setLoadingAfter(true)
    const requestFeedId = activeFeedIdRef.current

    void runLoggedOperation({
      operation: 'history.append',
      startEvent: 'loading newer messages...',
      details: { batchSize: PAGE_SIZE, source },
      apply: async (feedId) => {
        const storeFeed = await storage.loadPersistedDemoFeed(feedId)
        const storeMessages = storeFeed
          ? normalizeDemoMessages(feedId, storeFeed.messages)
          : []

        const newestViewportMsg = messagesRef.current.at(-1)
        if (!newestViewportMsg) {
          return {
            effect: 'none' as DemoViewportEffect,
            kind: 'patch' as DemoSnapshotKind,
            eventText: 'no messages in viewport',
          }
        }

        const resp = await api.getMessagesAround({
          feedId,
          anchor: { messageId: newestViewportMsg.id },
          before: 0,
          after: PAGE_SIZE,
        })

        if (isErrorResponse(resp)) {
          throw new Error(resp.errorMessage)
        }

        if (activeFeedIdRef.current !== feedId) {
          throw new DemoOperationCancelled('feed-switched')
        }

        feedMessagesRef.current = storeMessages
        const newerInView = resp.messages.filter(
          (message) => message.id !== newestViewportMsg.id,
        )
        const previousLoadedLastId = newestViewportMsg.id
        messagesRef.current = [...messagesRef.current, ...newerInView]
        hasMoreAfterRef.current = resp.hasMoreAfter

        return {
          effect: 'append' as DemoViewportEffect,
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
  }, [api, finishAfterDataRequest, log, runLoggedOperation, storage])

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
        const storeFeed = await storage.loadPersistedDemoFeed(feedId)
        const storeMessages = storeFeed
          ? normalizeDemoMessages(feedId, storeFeed.messages)
          : []

        const resp = await api.getLatestMessages({
          feedId,
          count: PAGE_SIZE,
        })

        if (isErrorResponse(resp)) {
          throw new Error(resp.errorMessage)
        }

        if (activeFeedIdRef.current !== feedId) {
          throw new DemoOperationCancelled('feed-switched')
        }

        feedMessagesRef.current = storeMessages
        messagesRef.current = normalizeDemoMessages(feedId, resp.messages)
        hasMoreBeforeRef.current = resp.hasMoreBefore
        hasMoreAfterRef.current = resp.hasMoreAfter
        lastViewportAnchorRef.current = undefined

        return {
          effect: 'auto-scroll-to-bottom' as DemoViewportEffect,
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
  }, [api, finishAfterDataRequest, log, runLoggedOperation, storage])

  const loadAroundTargetWindow = useCallback((
    target: { messageId: string; position?: number },
    reason: AroundTargetReason,
  ) => {
    const before =
      reason === 'jump'
        ? JUMP_AROUND_BEFORE_PAGE_SIZE
        : reason === 'viewport-compaction'
          ? VIEWPORT_COMPACTION_BEFORE_PAGE_SIZE
          : RESTORE_BEFORE_PAGE_SIZE
    const after =
      reason === 'jump'
        ? JUMP_AROUND_AFTER_PAGE_SIZE
        : reason === 'viewport-compaction'
          ? VIEWPORT_COMPACTION_AFTER_PAGE_SIZE
          : RESTORE_AFTER_PAGE_SIZE

    if (loadingAfterRef.current) {
      queuedAroundTargetRef.current = { target, reason }
      void log({
        requestId: createDemoRequestId('history.around'),
        operation: 'history.around',
        phase: 'info',
        feedId: activeFeedIdRef.current,
        messageCount: messagesRef.current.length,
        details: {
          reason: 'already-loading',
          queued: true,
          target,
          intent: reason,
        },
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
        before,
        after,
      },
      apply: async (feedId) => {
        const storeFeed = await storage.loadPersistedDemoFeed(feedId)
        const storeMessages = storeFeed
          ? normalizeDemoMessages(feedId, storeFeed.messages)
          : []

        const resp = await api.getMessagesAround({
          feedId,
          anchor: target,
          before,
          after,
        })

        if (isErrorResponse(resp)) {
          throw new Error(resp.errorMessage)
        }

        if (activeFeedIdRef.current !== feedId) {
          throw new DemoOperationCancelled('feed-switched')
        }

        feedMessagesRef.current = storeMessages
        messagesRef.current = normalizeDemoMessages(feedId, resp.messages)
        hasMoreBeforeRef.current = resp.hasMoreBefore
        hasMoreAfterRef.current = resp.hasMoreAfter

        return {
          effect: 'reset' as DemoViewportEffect,
          kind: 'reset' as DemoSnapshotKind,
          anchor: resp.anchor,
          anchorStatus: resp.anchorStatus,
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
  }, [api, finishAfterDataRequest, log, runLoggedOperation, storage])

  useEffect(() => {
    loadAroundTargetWindowRef.current = loadAroundTargetWindow
  }, [loadAroundTargetWindow])

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
          quoteCandidates: feedMessagesRef.current,
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
        const next: DemoMessage[] = []

        for (let index = 0; index < 4; index += 1) {
          next.push(createNewestMessage({
            feedId,
            sequence: startSequence + index,
            quoteCandidates: [...feedMessagesRef.current, ...next],
          }))
        }

        const projectedNext = next.map((message, index) =>
          index === 1
            ? {
                ...message,
                kind: 'longText' as const,
                body: `${message.body} ${message.body} ${message.body}`,
                expanded: true,
              }
            : message,
        )

        feedMessagesRef.current = [...feedMessagesRef.current, ...projectedNext]
        if (projectsIntoCurrentWindow) {
          messagesRef.current = [...messagesRef.current, ...projectedNext]
        }

        return {
          effect: projectsIntoCurrentWindow ? 'append' : 'none',
          kind: projectsIntoCurrentWindow ? 'append' : 'patch',
          eventText: projectsIntoCurrentWindow
            ? `appended long burst ${projectedNext.length}`
            : `queued long burst ${projectedNext.length} after current window`,
          details: {
            added: projectedNext.length,
            ids: projectedNext.map((message) => message.id),
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
          effect: 'anchor-risk',
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

  const publishOptimisticSendSnapshot = useCallback((input: {
    feedId: string
    clientMessageId: string
    body: string
    status: 'sending' | 'failed'
    effect: DemoViewportEffect
    kind: DemoSnapshotKind
  }) => {
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
    activeRuntimeRef.current?.setDataSnapshot(
      createDemoSnapshotFromItems({
        feedId: input.feedId,
        generation: generationRef.current,
        revision: revisionRef.current,
        items: [
          ...messagesRef.current.map(toCommittedItem),
          createOptimisticOutgoingItem({
            clientMessageId: input.clientMessageId,
            body: input.body,
            status: input.status,
          }),
        ],
        effect: input.effect,
        kind: input.kind,
        hasMoreBefore: hasMoreBeforeRef.current,
        hasMoreAfter: hasMoreAfterRef.current,
      }),
    )
    saveCurrentFeedSessionState()
  }, [saveCurrentFeedSessionState, syncDisplayedCounts])

  const sendMessage = useCallback((body: string): boolean => {
    const trimmed = body.trim()

    if (!trimmed) {
      return false
    }

    const feedId = activeFeedIdRef.current
    const requestId = createDemoRequestId('message.send')
    const details = {
      bodyLength: trimmed.length,
      lineCount: trimmed.split('\n').length,
    }

    if (feedLoadingRef.current) {
      setLastEvent('wait for feed before sending')
      void log({
        requestId,
        operation: 'message.send',
        phase: 'skip',
        feedId,
        messageCount: messagesRef.current.length,
        details: { reason: 'feed-loading', ...details },
      })
      return false
    }

    const projectsIntoCurrentWindow = !hasMoreAfterRef.current
    const clientMessageId = `${feedId}-client-${Date.now()}-${revisionRef.current + 1}`

    beginPendingOperation('message.send')
    setLastEvent('sending message...')

    if (projectsIntoCurrentWindow) {
      publishOptimisticSendSnapshot({
        feedId,
        clientMessageId,
        body: trimmed,
        status: 'sending',
        effect: 'auto-scroll-to-bottom',
        kind: 'append',
      })
    }

    void log({
      requestId,
      operation: 'message.send',
      phase: 'start',
      feedId,
      messageCount: messagesRef.current.length,
      details: {
        ...details,
        optimistic: projectsIntoCurrentWindow,
        clientMessageId,
      },
    })

    void (async () => {
      try {
        await sleep(OPERATION_DELAYS['message.send'])

        if (activeFeedIdRef.current !== feedId) {
          await log({
            requestId,
            operation: 'message.send',
            phase: 'cancel',
            feedId,
            messageCount: messagesRef.current.length,
            details: { reason: 'feed-switched', clientMessageId },
          })
          return
        }

        if (
          options.faults?.sendFailureMode === 'fail-first-and-retry-succeeds' &&
          !sendFailureConsumedRef.current
        ) {
          sendFailureConsumedRef.current = true
          failedOptimisticSendRef.current = {
            feedId,
            clientMessageId,
            body: trimmed,
          }

          if (projectsIntoCurrentWindow) {
            publishOptimisticSendSnapshot({
              feedId,
              clientMessageId,
              body: trimmed,
              status: 'failed',
              effect: 'items-change',
              kind: 'patch',
            })
          }

          setLastEvent('message send failed')
          await log({
            requestId,
            operation: 'message.send',
            phase: 'error',
            feedId,
            messageCount: messagesRef.current.length,
            error: 'send-failed-e2e',
            details: {
              ...details,
              clientMessageId,
              optimistic: projectsIntoCurrentWindow,
            },
          })
          return
        }

        const message = createOutgoingMessage(trimmed, {
          feedId,
          sequence: getNextMessageSequence(feedMessagesRef.current),
          quoteCandidates: feedMessagesRef.current,
          random: () => 1,
        })

        feedMessagesRef.current = [...feedMessagesRef.current, message]
        // 用户主动发送消息是明确的 latest intent：旧的中间阅读 anchor 不能继续影响恢复。
        lastViewportAnchorRef.current = undefined

        if (projectsIntoCurrentWindow) {
          messagesRef.current = [...messagesRef.current, message]
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
          activeRuntimeRef.current?.setDataSnapshot(
            createDemoIdentityRemapSnapshot({
              feedId,
              generation: generationRef.current,
              revision: revisionRef.current,
              items: messagesRef.current.map(toCommittedItem),
              identityRemaps: [
                createOutgoingIdentityRemap({
                  clientMessageId,
                  messageId: message.id,
                }),
              ],
              anchor: {
                messageId: message.id,
                position: message.sequence,
              },
              hasMoreBefore: hasMoreBeforeRef.current,
              hasMoreAfter: hasMoreAfterRef.current,
            }),
          )
          activeRuntimeRef.current?.dispatch({ type: 'followBottom' })
          saveCurrentFeedSessionState()
          await persistCurrentFeed()
          setLastEvent(`sent ${message.id}`)
          await log({
            requestId,
            operation: 'message.send',
            phase: 'success',
            feedId,
            messageCount: messagesRef.current.length,
            details: {
              ...details,
              sentId: message.id,
              clientMessageId,
              visibleInCurrentWindow: true,
              rebuiltLatestWindow: false,
              viewportModifier: 'identity-remap',
            },
          })
          return
        }

        // 当前窗口不是 latest 时，send 需要模拟真实 IM：写入后重新请求 latest page，
        // 让 runtime 从底部重建 projection，而不是把自发消息排在不可见窗口外。
        await storage.savePersistedDemoFeed({
          version: 1,
          feedId,
          revision: revisionRef.current,
          hasMoreBefore: hasMoreBeforeRef.current,
          lastViewportAnchor: undefined,
          messages: feedMessagesRef.current,
          updatedAt: new Date().toISOString(),
        })

        const latestResp = await api.getLatestMessages({
          feedId,
          count: PAGE_SIZE,
        })

        if (isErrorResponse(latestResp)) {
          throw new Error(latestResp.errorMessage)
        }

        messagesRef.current = normalizeDemoMessages(feedId, latestResp.messages)
        hasMoreBeforeRef.current = latestResp.hasMoreBefore
        hasMoreAfterRef.current = latestResp.hasMoreAfter
        publishCurrentMessages('auto-scroll-to-bottom', 'reset', {
          anchor: latestResp.anchor,
          anchorStatus: latestResp.anchorStatus,
        })
        await persistCurrentFeed()
        setLastEvent(`sent ${message.id} and rebuilt latest`)
        await log({
          requestId,
          operation: 'message.send',
          phase: 'success',
          feedId,
          messageCount: messagesRef.current.length,
          details: {
            ...details,
            sentId: message.id,
            clientMessageId,
            visibleInCurrentWindow: true,
            rebuiltLatestWindow: true,
            latestTotal: latestResp.total,
            hasMoreBefore: latestResp.hasMoreBefore,
            hasMoreAfter: latestResp.hasMoreAfter,
            anchor: latestResp.anchor,
          },
        })
      } catch (error) {
        const message = getErrorMessage(error)
        setLastEvent('message.send failed')
        await log({
          requestId,
          operation: 'message.send',
          phase: 'error',
          feedId,
          messageCount: messagesRef.current.length,
          error: message,
        })
      } finally {
        endPendingOperation('message.send')
      }
    })()

    return true
  }, [
    api,
    beginPendingOperation,
    endPendingOperation,
    log,
    persistCurrentFeed,
    publishOptimisticSendSnapshot,
    publishCurrentMessages,
    saveCurrentFeedSessionState,
    storage,
    syncDisplayedCounts,
    options.faults?.sendFailureMode,
  ])

  const retryFailedSend = useCallback((): boolean => {
    const failed = failedOptimisticSendRef.current

    if (
      !failed ||
      feedLoadingRef.current ||
      failed.feedId !== activeFeedIdRef.current
    ) {
      return false
    }

    const feedId = failed.feedId
    const requestId = createDemoRequestId('message.send')
    const details = {
      bodyLength: failed.body.length,
      lineCount: failed.body.split('\n').length,
      retry: true,
      clientMessageId: failed.clientMessageId,
    }

    beginPendingOperation('message.send')
    setLastEvent('retrying message...')
    publishOptimisticSendSnapshot({
      feedId,
      clientMessageId: failed.clientMessageId,
      body: failed.body,
      status: 'sending',
      effect: 'items-change',
      kind: 'patch',
    })

    void log({
      requestId,
      operation: 'message.send',
      phase: 'start',
      feedId,
      messageCount: messagesRef.current.length,
      details,
    })

    void (async () => {
      try {
        await sleep(OPERATION_DELAYS['message.send'])

        if (activeFeedIdRef.current !== feedId) {
          await log({
            requestId,
            operation: 'message.send',
            phase: 'cancel',
            feedId,
            messageCount: messagesRef.current.length,
            details: { reason: 'feed-switched', ...details },
          })
          return
        }

        const message = createOutgoingMessage(failed.body, {
          feedId,
          sequence: getNextMessageSequence(feedMessagesRef.current),
          quoteCandidates: feedMessagesRef.current,
          random: () => 1,
        })

        feedMessagesRef.current = [...feedMessagesRef.current, message]
        messagesRef.current = [...messagesRef.current, message]
        failedOptimisticSendRef.current = null
        lastViewportAnchorRef.current = undefined
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
        activeRuntimeRef.current?.setDataSnapshot(
          createDemoIdentityRemapSnapshot({
            feedId,
            generation: generationRef.current,
            revision: revisionRef.current,
            items: messagesRef.current.map(toCommittedItem),
            identityRemaps: [
              createOutgoingIdentityRemap({
                clientMessageId: failed.clientMessageId,
                messageId: message.id,
              }),
            ],
            anchor: {
              messageId: message.id,
              position: message.sequence,
            },
            hasMoreBefore: hasMoreBeforeRef.current,
            hasMoreAfter: hasMoreAfterRef.current,
          }),
        )
        activeRuntimeRef.current?.dispatch({ type: 'followBottom' })
        saveCurrentFeedSessionState()
        await persistCurrentFeed()
        setLastEvent(`sent ${message.id}`)
        await log({
          requestId,
          operation: 'message.send',
          phase: 'success',
          feedId,
          messageCount: messagesRef.current.length,
          details: {
            ...details,
            sentId: message.id,
            visibleInCurrentWindow: true,
            viewportModifier: 'identity-remap',
          },
        })
      } catch (error) {
        setLastEvent('message retry failed')
        await log({
          requestId,
          operation: 'message.send',
          phase: 'error',
          feedId,
          messageCount: messagesRef.current.length,
          error: getErrorMessage(error),
          details,
        })
      } finally {
        endPendingOperation('message.send')
      }
    })()

    return true
  }, [
    beginPendingOperation,
    endPendingOperation,
    log,
    persistCurrentFeed,
    publishOptimisticSendSnapshot,
    saveCurrentFeedSessionState,
    syncDisplayedCounts,
  ])

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

  const jumpToQuote = useCallback((input: {
    origin: { messageId: string; position?: number }
    target: { messageId: string; position?: number }
  }) => {
    void log({
      requestId: createDemoRequestId('runtime.command.quoteJump'),
      operation: 'runtime.command.quoteJump',
      phase: 'info',
      feedId: activeFeedIdRef.current,
      messageCount: messagesRef.current.length,
      details: input,
    })
    activeRuntime.dispatch({
      type: 'jump',
      origin: input.origin,
      target: input.target,
    })
  }, [activeRuntime, log])

  const selectFeed = useCallback((feedId: string) => {
    if (feedId === selectedFeedId) {
      return
    }

    const previousFeedId = activeFeedIdRef.current
    const previousMessageCount = messagesRef.current.length
    const feed = getDemoFeedDefinition(feedId)
    const feedLoadRequestId = createDemoRequestId('feed.load')

    saveCurrentFeedSessionState()
    setSelectedFeedId(feedId)

    const cachedState = feedSessionStateRef.current.get(feedId)
    const hasCachedRuntime = runtimeCache.hasRuntime(feedId)
    const cachedRuntime = hasCachedRuntime
      ? runtimeCache.getRuntime(feedId)
      : null
    const shouldRebuildCachedRuntime =
      !!cachedRuntime && shouldRebuildRuntimeForDestination(cachedRuntime)
    if (shouldRebuildCachedRuntime) {
      runtimeCache.deleteRuntime(feedId)
    }
    const runtimeCacheHit =
      hasCachedRuntime && !!cachedState && !shouldRebuildCachedRuntime
    const nextRuntime = runtimeCacheHit && cachedRuntime
      ? cachedRuntime
      : runtimeCache.getRuntime(feedId)
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
      details: {
        nextFeedId: feedId,
        runtimeCacheHit,
        cacheRebuildReason: shouldRebuildCachedRuntime
          ? 'spacer-threshold'
          : null,
      },
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

        const persisted = await storage.loadPersistedDemoFeed(feedId)
        const isActiveAfterDelay = activeFeedIdRef.current === feedId
        const nextRevision = Math.max(
          1,
          (isActiveAfterDelay ? revisionRef.current : persisted?.revision ?? 1) + 1,
        )

        await storage.savePersistedDemoFeed({
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
          queuedAroundTargetRef.current = null
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
    storage,
    syncDisplayedCounts,
  ])

  useEffect(() => {
    return () => {
      saveCurrentFeedSessionState()
    }
  }, [saveCurrentFeedSessionState])

  useEffect(() => {
    return () => {
      clearEventStormTimer()
      clearBotPushTimer()
      eventStormRunningRef.current = false
      botPushActiveRef.current = false
    }
  }, [clearBotPushTimer, clearEventStormTimer])

  useEffect(() => {
    const feed = getDemoFeedDefinition(activeFeedId)
    const requestId = createDemoRequestId('feed.load')
    const runtimeCacheHit = nextFeedSwitchRuntimeCacheHitRef.current
    const stagedActivationSkip = stagedActivationSkipRef.current.delete(activeFeedId)

    nextFeedSwitchRuntimeCacheHitRef.current = false
    activeFeedIdRef.current = activeFeedId
    queuedLatestFollowBottomRef.current = false
    queuedAroundTargetRef.current = null

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
        return
      }

      if (
        event.type === 'destinationSettled' &&
        event.intent === 'jump' &&
        event.feedId === activeFeedIdRef.current
      ) {
        if (event.resolution === 'fallback-deleted') {
          window.alert('Quoted message was deleted. Jumped to a nearby message.')
          setLastEvent('quoted message was deleted; jumped to nearby message')
          return
        }

        highlightJumpTarget(event.target.messageId)
      }
    })

    return unsubscribe
  }, [
    activeRuntime,
    highlightJumpTarget,
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
    hasMoreBefore,
    hasMoreAfter,
    loadingBefore,
    loadingAfter,
    feedLoading,
    eventStormRunning,
    botPushActive,
    highlightedMessageId,
    highlightToken,
    pendingOperation,
    lastEvent,
    selectFeed,
    loadHistoryBatch,
    loadFutureBatch,
    appendMessage,
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

class DemoOperationCancelled extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

function readNumberDetail(
  result: AdvancedMockPublishResult,
  key: string,
): number {
  const value = result.details[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
