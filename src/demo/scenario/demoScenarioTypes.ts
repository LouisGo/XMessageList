import type {
  MessageIdentityAnchor,
  MessageListRuntime,
  ViewportAnchorChangedEvent,
} from '../../runtime/index'
import type { MessageListDataRuntime } from '../../runtime/data/index'
import type { DemoMessage } from '../data/demoData'
import { DEMO_FEEDS, getDemoFeedDefinition } from '../data/demoFeeds'

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
  sessionLoadingOverlayVisible: boolean
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
  appendMessages: (count: number) => void
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
  deferNextSessionResponse: (delayMs: number) => void
  sendOptimisticMessage: () => void
  alignPendingOptimisticAtStart: () => void
  resolveOptimisticRemap: () => void
  sendOptimisticAndRemap: () => Promise<void>
}

export type DemoDataRuntimeGetter = (
  feedId: string,
) => MessageListDataRuntime<DemoMessage>

export type DemoSegmentPublisher = (
  dataRuntime: MessageListDataRuntime<DemoMessage>,
) => void

export type DemoLoadedMessagesReplacer = (input: {
  feedId: string
  feedMessages: DemoMessage[]
  messages: DemoMessage[]
  changedKeys: string[]
  eventText: string
}) => Promise<void>

export type PendingOptimisticRemap = {
  feedId: string
  localId: string
  serverId: string
  remap: Parameters<MessageListDataRuntime<DemoMessage>['applyIdentityRemap']>[0][number]
}

export type DemoHighlightState = {
  setHighlightedMessageId: (messageId: string | null) => void
  setHighlightToken: (updater: (token: number) => number) => void
  highlightTimerRef: { current: number | null }
}

export type RuntimeAnchorChangeHandler = (
  event: ViewportAnchorChangedEvent,
) => void

export type PersistedRuntimeAnchor = MessageIdentityAnchor
