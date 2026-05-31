import {
  createMessageListManager,
  type MessageListAdapter,
  type MessageListManager,
  type MessageListPage,
  type MessageListRequestResult,
  type MessageListResolvedAnchor,
  type MessageListSession,
} from '../../index'
import {
  createDemoMessages,
  type DemoMessage,
} from '../data/demoData'
import {
  getLatestMessages,
  getMessagesAround,
  replaceDemoFeedMessages,
  saveDemoViewportAnchor,
} from '../data/demoMessageApi'
import type { MessageIdentityAnchor as DemoApiAnchor } from '../data/demoMessageApiTypes'
import {
  EDGE_LOAD_DELAY_BASE_MS,
  PAGE_SIZE,
} from './demoScenarioConfig'
import {
  resolveScenarioTotalMessages,
  usesAroundBootstrap,
} from './demoScenarioHelpers'
import type { SavedRuntimeAnchor } from './demoScenarioRuntimeHelpers'

type DemoConversation = {
  id: string
}

export type DemoManagerOptions = {
  getActiveFeedId: () => string
  getSelectedFeedId: () => string
  isFeedLoading: () => boolean
  consumeDeferredEdgeResponseDelay: () => number
  consumeDeferredSessionResponseDelay: () => number
  loadAnchor: (feedId: string) => SavedRuntimeAnchor | null
  saveAnchor: (
    feedId: string,
    anchor: MessageListResolvedAnchor,
    offsetWithinMessage?: number,
  ) => void
  setEdgeLoading: (edge: 'before' | 'after', loading: boolean) => void
  setFeedLoading: (loading: boolean) => void
  setLastEvent: (eventText: string) => void
  setMessageCount: (messageCount: number) => void
  setPendingFeedId: (feedId: string | null) => void
  syncLoadedState: (feedId: string, eventText?: string) => void
}

export function createDemoManager(
  input: DemoManagerOptions,
): MessageListManager<DemoMessage> {
  return createMessageListManager<DemoMessage, DemoConversation>({
    defaults: {
      pageSize: PAGE_SIZE,
      maxItems: 40,
      keepAlive: {
        maxSessions: 3,
        ttlMs: 10 * 60_000,
      },
    },
    getConversation: (id) => ({ id }),
    getAdapter: (conversation) => createDemoAdapter(conversation, input),
    onRequestResult: (result) => {
      handleDemoRequestResult(result, input)
    },
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
          feedId: input.feedId,
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
  conversation: DemoConversation,
  input: DemoManagerOptions,
): MessageListAdapter<DemoMessage, DemoConversation> {
  return {
    row: {
      getKey: (row) => row.id,
      getAnchor: (row) => ({
        id: row.id,
        feedId: row.feedId,
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
          feedId: conversation.id,
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
        await wait(EDGE_LOAD_DELAY_BASE_MS)
        const targetId = resolveAnchorMessageId(context.target)

        if (!targetId) {
          throw new Error('runtime requested anchor without id')
        }

        const resp = await getMessagesAround({
          feedId: conversation.id,
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
      load: (context) => input.loadAnchor(context.id)?.anchor ?? null,
      save: (context, anchor, offsetWithinMessage) => {
        input.saveAnchor(context.id, anchor, offsetWithinMessage)
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
  context: Parameters<MessageListAdapter<DemoMessage, DemoConversation>['request']['loadBefore']>[0],
  input: DemoManagerOptions,
): Promise<MessageListPage<DemoMessage>> {
  const boundaryMessage = context.boundaryRow

  if (!boundaryMessage) {
    throw new Error(`missing ${edge} boundary message`)
  }

  const isSelectedFeed = input.getSelectedFeedId() === context.id
  const canExposeEdgeLoading = isSelectedFeed &&
    !input.isFeedLoading() &&
    context.reason !== 'underflow-fill'
  const deferredDelayMs = isSelectedFeed
    ? input.consumeDeferredEdgeResponseDelay()
    : 0

  if (canExposeEdgeLoading) {
    input.setEdgeLoading(edge, true)
  }

  try {
    await wait(deferredDelayMs > 0 ? deferredDelayMs : EDGE_LOAD_DELAY_BASE_MS)
    const resp = await getMessagesAround({
      feedId: context.id,
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
  } finally {
    if (canExposeEdgeLoading && input.getSelectedFeedId() === context.id) {
      input.setEdgeLoading(edge, false)
    }
  }
}

function handleDemoRequestResult(
  result: MessageListRequestResult<DemoMessage, DemoConversation>,
  input: DemoManagerOptions,
): void {
  if (result.status !== 'applied') {
    if (result.id === input.getActiveFeedId() && result.status === 'failed') {
      input.setLastEvent(`request failed: ${String(result.error)}`)
    }
    return
  }

  if (result.id !== input.getActiveFeedId()) {
    return
  }

  input.setFeedLoading(false)
  input.setPendingFeedId(null)
  input.syncLoadedState(result.id, describeRequestResult(result))
  if (typeof result.page?.total === 'number') {
    input.setMessageCount(result.page.total)
  }
}

function describeRequestResult(
  result: MessageListRequestResult<DemoMessage, DemoConversation>,
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
          feedId: input.feedId,
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
      feedId: input.feedId,
      stableId: target.id,
      serverId: target.id,
    },
    rows,
    hasMoreBefore: start > 0,
    hasMoreAfter: end < feedMessages.length,
    anchor: {
      id: target.id,
      feedId: input.feedId,
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
