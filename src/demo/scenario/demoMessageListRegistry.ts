import {
  createMessageListSessionRegistry,
  type MessageListAdapter,
  type MessageListAnchorMemoryValue,
  type MessageListPage,
  type MessageListRequestResult,
  type MessageListResolvedAnchor,
  type MessageListRuntimeLogEvent,
  type MessageListSession,
  type MessageListSessionRegistry,
} from '../../index'
import {
  createDemoMessages,
  type DemoMessage,
} from '../data/demoData'
import {
  getLatestMessages,
  getMessagesAround,
  loadDemoFeedMessages,
  loadDemoViewportAnchor,
  replaceDemoFeedMessages,
  saveDemoViewportAnchor,
} from '../data/demoMessageApi'
import type { MessageIdentityAnchor as DemoApiAnchor } from '../data/demoMessageApiTypes'
import {
  DEMO_RETENTION,
  EDGE_LOAD_DELAY_BASE_MS,
  INCOMING_FOLLOW_DISTANCE_PX,
  PAGE_SIZE,
} from './demoScenarioConfig'
import {
  resolveScenarioTotalMessages,
  usesAroundBootstrap,
} from './demoScenarioHelpers'
import {
  toPersistedViewportAnchor,
  type SavedRuntimeAnchor,
} from './demoScenarioRuntimeHelpers'

type DemoFeedRecord = {
  id: string
}

export type DemoFeed = DemoFeedRecord

export type DemoRegistryOptions = {
  getActiveFeedId: () => string
  getSelectedFeedId: () => string
  isFeedLoading: () => boolean
  consumeDeferredEdgeResponseDelay: () => number
  consumeDeferredSessionResponseDelay: () => number
  canCompleteRequestActivation: (feedId: string) => boolean
  loadAnchor: (feedId: string) => SavedRuntimeAnchor | null
  saveAnchor: (feedId: string, value: SavedRuntimeAnchor) => void
  setFeedLoading: (loading: boolean) => void
  setLastEvent: (eventText: string) => void
  setMessageCount: (messageCount: number) => void
  setPendingFeedId: (feedId: string | null) => void
  syncLoadedState: (
    result: MessageListRequestResult<DemoMessage, DemoFeedRecord>,
    eventText?: string,
  ) => void
  onRuntimeEvent?: (event: MessageListRuntimeLogEvent) => void
}

export function createDemoRegistry(
  input: DemoRegistryOptions,
): MessageListSessionRegistry<DemoMessage, DemoFeed> {
  return createMessageListSessionRegistry<DemoMessage, DemoFeedRecord>({
    defaults: {
      pageSize: PAGE_SIZE,
      retention: DEMO_RETENTION,
      keepAlive: {
        maxSessions: 3,
        ttlMs: 10 * 60_000,
      },
    },
    scrollMotion: {
      enabled: true,
    },
    getSessionSource: (id) => ({ id }),
    getAdapter: (source) => createDemoAdapter(source, input),
    tailEvents: {
      getPageFocus: () => globalThis.location?.pathname === '/e2e' ||
        (globalThis.document?.hasFocus?.() ?? true),
      shouldFollowRemoteAppend: (context) =>
        context.pageFocused &&
        (
          context.bottomLockState === 'LOCKED' ||
          context.pendingIntent === 'follow-bottom' ||
          context.distanceToBottom <= INCOMING_FOLLOW_DISTANCE_PX
        ),
    },
    onRequestResult: (result) => {
      handleDemoRequestResult(result, input)
    },
    onRuntimeEvent: input.onRuntimeEvent,
  })
}

export async function prepareDemoE2EScenario(input: {
  scenarioId: string
  feedId: string
  pageSize: number
  session: MessageListSession<DemoMessage>
}): Promise<{
  feedId: string
  messages: DemoMessage[]
  messageCount: number
  shouldScrollToLatest: boolean
}> {
  const feedMessages = createDemoMessages(
    resolveScenarioTotalMessages(input.scenarioId),
    input.feedId,
  )
  replaceDemoFeedMessages(input.feedId, feedMessages)
  saveDemoViewportAnchor(input.feedId, undefined)

  const aroundBootstrap = usesAroundBootstrap(input.scenarioId)

  if (aroundBootstrap) {
    return resetAroundE2EScenario(input, feedMessages)
  }

  const latest = feedMessages.slice(Math.max(0, feedMessages.length - input.pageSize))
  const latestMessage = latest.at(-1)
  input.session.rows.resetLatest({
    rows: latest,
    hasMoreBefore: feedMessages.length > input.pageSize,
    hasMoreAfter: false,
    anchor: latestMessage
      ? {
        id: latestMessage.id,
        sessionId: input.feedId,
        stableId: latestMessage.id,
        serverId: latestMessage.id,
      }
      : undefined,
    anchorStatus: 'normal',
  })
  return {
    feedId: input.feedId,
    messages: latest,
    messageCount: feedMessages.length,
    shouldScrollToLatest: true,
  }
}

function createDemoAdapter(
  feed: DemoFeedRecord,
  input: DemoRegistryOptions,
): MessageListAdapter<DemoMessage, DemoFeedRecord> {
  return {
    row: {
      getKey: (row) => row.id,
      getAnchor: (row) => ({
        id: row.id,
        sessionId: feed.id,
        stableId: row.id,
        serverId: row.id,
      }),
      getVersion: (row) => [
        row.body,
        row.editedAt ?? '',
        row.expanded ? 'expanded' : 'collapsed',
        row.reactions.join(','),
      ].join('|'),
      getKind: () => 'message',
    },
    request: {
      loadLatest: async (context) => {
        const delayMs = input.consumeDeferredSessionResponseDelay()
        if (delayMs > 0) {
          await wait(delayMs)
        }
        const resp = await getLatestMessages({
          feedId: feed.id,
          count: context.pageSize,
        })

        if (resp.ok === false) {
          throw new Error(resp.errorMessage)
        }

        return toDemoPage(resp.messages, {
          feedId: resp.feedId,
          hasMoreBefore: resp.hasMoreBefore,
          hasMoreAfter: resp.hasMoreAfter,
          anchorMessageId: resp.anchor.messageId,
          anchorStatus: resp.anchorStatus,
          total: resp.total,
        })
      },
      loadBefore: (context) => loadDemoEdgePage('before', context, input),
      loadAfter: (context) => loadDemoEdgePage('after', context, input),
      loadAround: async (context) => {
        const delayMs = input.consumeDeferredSessionResponseDelay()
        await wait(delayMs > 0 ? delayMs : EDGE_LOAD_DELAY_BASE_MS)
        const targetId = resolveAnchorMessageId(context.target)

        if (!targetId) {
          throw new Error('runtime requested anchor without id')
        }

        const resp = await getMessagesAround({
          feedId: feed.id,
          anchor: toDemoApiAnchor(context.target),
          before: Math.floor(context.pageSize / 2),
          after: Math.ceil(context.pageSize / 2),
        })

        if (resp.ok === false) {
          throw new Error(resp.errorMessage)
        }

        return toDemoPage(resp.messages, {
          feedId: resp.feedId,
          hasMoreBefore: resp.hasMoreBefore,
          hasMoreAfter: resp.hasMoreAfter,
          anchorMessageId: resp.anchor.messageId,
          anchorStatus: resp.anchorStatus,
          total: resp.total,
        })
      },
    },
    anchorMemory: {
      load: async (context) => {
        const cached = input.loadAnchor(context.sessionId)
        if (cached) {
          return cached
        }

        const persisted = await loadDemoViewportAnchor(context.sessionId)
        if (!persisted) {
          return null
        }

        const restored = toSavedRuntimeAnchor(context.sessionId, {
          anchor: {
            id: persisted.messageId,
            sessionId: context.sessionId,
            stableId: persisted.messageId,
            serverId: persisted.messageId,
          },
          offsetWithinMessage: persisted.offsetWithinMessage,
        })

        if (restored) {
          input.saveAnchor(context.sessionId, restored)
        }

        return restored
      },
      save: async (context, value) => {
        const saved = toSavedRuntimeAnchor(context.sessionId, value)
        if (!saved) {
          return
        }

        input.saveAnchor(context.sessionId, saved)
        const feedMessages = await loadDemoFeedMessages(context.sessionId)
        saveDemoViewportAnchor(
          context.sessionId,
          toPersistedViewportAnchor(
            saved.anchor,
            feedMessages,
            saved.offsetWithinMessage ?? 0,
          ),
        )
      },
    },
    readReceipts: {
      batchDelayMs: 120,
      markRead: () => undefined,
    },
  }
}

async function loadDemoEdgePage(
  edge: 'before' | 'after',
  context: Parameters<MessageListAdapter<DemoMessage, DemoFeedRecord>['request']['loadBefore']>[0],
  input: DemoRegistryOptions,
): Promise<MessageListPage<DemoMessage>> {
  const boundaryMessage = context.boundaryRow

  if (!boundaryMessage) {
    throw new Error(`missing ${edge} boundary message`)
  }

  const deferredDelayMs = input.getSelectedFeedId() === context.sessionId
    ? input.consumeDeferredEdgeResponseDelay()
    : 0

  await wait(deferredDelayMs > 0 ? deferredDelayMs : EDGE_LOAD_DELAY_BASE_MS)
  const resp = await getMessagesAround({
    feedId: context.sessionId,
    anchor: {
      messageId: boundaryMessage.id,
      position: boundaryMessage.sequence,
    },
    before: edge === 'before' ? context.pageSize : 0,
    after: edge === 'after' ? context.pageSize : 0,
  })

  if (resp.ok === false) {
    throw new Error(resp.errorMessage)
  }

  return toDemoPage(resp.messages, {
    feedId: resp.feedId,
    hasMoreBefore: resp.hasMoreBefore,
    hasMoreAfter: resp.hasMoreAfter,
    anchorMessageId: resp.anchor.messageId,
    anchorStatus: resp.anchorStatus,
    total: resp.total,
  })
}

function handleDemoRequestResult(
  result: MessageListRequestResult<DemoMessage, DemoFeedRecord>,
  input: DemoRegistryOptions,
): void {
  if (result.status !== 'applied') {
    if (result.sessionId === input.getActiveFeedId() && result.status === 'failed') {
      if (input.canCompleteRequestActivation(result.sessionId)) {
        input.setFeedLoading(false)
        input.setPendingFeedId(null)
      }
      input.setLastEvent(`request failed: ${String(result.error)}`)
    }
    return
  }

  if (result.sessionId !== input.getActiveFeedId()) {
    return
  }

  if (!input.canCompleteRequestActivation(result.sessionId)) {
    return
  }

  input.setFeedLoading(false)
  input.setPendingFeedId(null)
  input.syncLoadedState(result, describeRequestResult(result))
  if (typeof result.page?.total === 'number') {
    input.setMessageCount(result.page.total)
  }
}

function describeRequestResult(
  result: MessageListRequestResult<DemoMessage, DemoFeedRecord>,
): string {
  const count = result.page?.rows.length ?? 0

  if (result.kind === 'latest') {
    return `loaded ${count} latest messages`
  }

  if (result.kind === 'around') {
    return 'loaded around anchor'
  }

  return `loaded ${count} ${result.kind} messages`
}

function toDemoPage(
  rows: DemoMessage[],
  input: {
    feedId: string
    hasMoreBefore: boolean
    hasMoreAfter: boolean
    anchorMessageId?: string
    anchorStatus?: MessageListPage<DemoMessage>['anchorStatus']
    total?: number
  },
): MessageListPage<DemoMessage> {
  return {
    rows,
    hasMoreBefore: input.hasMoreBefore,
    hasMoreAfter: input.hasMoreAfter,
    anchor: input.anchorMessageId
      ? {
        id: input.anchorMessageId,
        sessionId: input.feedId,
        stableId: input.anchorMessageId,
        serverId: input.anchorMessageId,
      }
      : undefined,
    anchorStatus: input.anchorStatus,
    total: input.total,
  }
}

function resetAroundE2EScenario(
  input: Parameters<typeof prepareDemoE2EScenario>[0],
  feedMessages: DemoMessage[],
): Awaited<ReturnType<typeof prepareDemoE2EScenario>> {
  const targetIndex = Math.floor(feedMessages.length / 2)
  const target = feedMessages[targetIndex] ?? feedMessages[0]
  const before = input.scenarioId === 'underflow.dual-edge-arbitration' ? 1 : 8
  const after = input.scenarioId === 'underflow.dual-edge-arbitration' ? 1 : 8
  const start = Math.max(0, targetIndex - before)
  const end = Math.min(feedMessages.length, targetIndex + after + 1)
  const rows = feedMessages.slice(start, end)

  input.session.rows.resetAround({
    target: {
      id: target.id,
      sessionId: input.feedId,
      stableId: target.id,
      serverId: target.id,
    },
    rows,
    hasMoreBefore: start > 0,
    hasMoreAfter: end < feedMessages.length,
    anchor: {
      id: target.id,
      sessionId: input.feedId,
      stableId: target.id,
      serverId: target.id,
    },
    anchorStatus: 'normal',
  })
  return {
    feedId: input.feedId,
    messages: rows,
    messageCount: feedMessages.length,
    shouldScrollToLatest: false,
  }
}

function resolveAnchorMessageId(
  anchor: MessageListResolvedAnchor | undefined,
): string {
  return anchor?.serverId ?? anchor?.stableId ?? anchor?.localId ?? ''
}

function toSavedRuntimeAnchor(
  feedId: string,
  value: MessageListAnchorMemoryValue,
): SavedRuntimeAnchor | null {
  const messageId = value.anchor.serverId ??
    value.anchor.stableId ??
    value.anchor.localId ??
    value.anchor.id

  if (!messageId) {
    return null
  }

  return {
    anchor: {
      id: messageId,
      sessionId: feedId,
      stableId: messageId,
      serverId: messageId,
      fallbackStableId: value.anchor.fallbackStableId,
      fallbackReason: value.anchor.fallbackReason,
    },
    offsetWithinMessage: value.offsetWithinMessage,
  }
}

function toDemoApiAnchor(
  anchor: MessageListResolvedAnchor | undefined,
): DemoApiAnchor {
  return {
    messageId: resolveAnchorMessageId(anchor),
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
