import {
  createDemoMessages,
  normalizeDemoMessages,
  type DemoMessage,
} from '../demo/demoData'
import type {
  DemoMessageScenarioApi,
  DemoMessageScenarioStorage,
} from '../demo/useDemoMessageScenario'
import type { PersistedDemoFeed } from '../demo/demoLocalStoreClient'
import type {
  GetLatestMessagesReq,
  GetLatestMessagesResp,
  GetMessagesAroundReq,
  GetMessagesAroundResp,
  MessageIdentityAnchor,
  MessagesAroundOkResp,
} from '../demo/demoMessageApiTypes'
import type { E2EScenarioDefinition } from './e2eScenarioRegistry'

const E2E_SEED_UPDATED_AT = '1970-01-01T00:00:00.000Z'

export type E2EDemoStore = {
  api: DemoMessageScenarioApi
  storage: DemoMessageScenarioStorage
  resetScenario: (scenario: E2EScenarioDefinition) => void
}

export function createE2EDemoStore(
  initialScenario: E2EScenarioDefinition,
): E2EDemoStore {
  const feeds = new Map<string, PersistedDemoFeed>()

  const resetScenario = (scenario: E2EScenarioDefinition) => {
    feeds.clear()
    feeds.set(scenario.feedId, createSeedFeed(scenario))
  }

  const loadPersistedDemoFeed = async (
    feedId: string,
  ): Promise<PersistedDemoFeed | null> => {
    const feed = feeds.get(feedId)
    return feed ? cloneFeed(feed) : null
  }

  const savePersistedDemoFeed = async (feed: PersistedDemoFeed) => {
    feeds.set(feed.feedId, cloneFeed(feed))
  }

  const getLatestMessages = async (
    req: GetLatestMessagesReq,
  ): Promise<GetLatestMessagesResp<DemoMessage>> => {
    const feed = feeds.get(req.feedId)

    if (!feed) {
      return {
        ok: false,
        feedId: req.feedId,
        errorCode: 'feed-not-found',
        errorMessage: `feed ${req.feedId} not found in e2e store`,
      }
    }

    const all = normalizeDemoMessages(req.feedId, feed.messages)
    const total = all.length
    const limit = req.count ?? 40

    if (total === 0) {
      return {
        ok: true,
        anchor: { messageId: '' },
        anchorStatus: 'normal',
        feedId: req.feedId,
        hasMoreAfter: false,
        hasMoreBefore: false,
        total: 0,
        messages: [],
      }
    }

    const messages = all.slice(Math.max(0, total - limit))
    const lastMessage = messages[messages.length - 1]

    return {
      ok: true,
      anchor: {
        messageId: lastMessage?.id ?? '',
        position: lastMessage?.sequence,
      },
      anchorStatus: 'normal',
      feedId: req.feedId,
      hasMoreAfter: false,
      hasMoreBefore: total > limit,
      total,
      messages,
    }
  }

  const getMessagesAround = async (
    req: GetMessagesAroundReq,
  ): Promise<GetMessagesAroundResp<DemoMessage>> => {
    const feed = feeds.get(req.feedId)

    if (!feed) {
      return {
        ok: false,
        feedId: req.feedId,
        errorCode: 'feed-not-found',
        errorMessage: `feed ${req.feedId} not found in e2e store`,
      }
    }

    const all = normalizeDemoMessages(req.feedId, feed.messages)
    const total = all.length

    if (total === 0) {
      return {
        ok: false,
        feedId: req.feedId,
        errorCode: 'empty-feed',
        errorMessage: `feed ${req.feedId} has no messages`,
      }
    }

    const resolvedAnchor = resolveAnchor(all, req.anchor)

    if (!resolvedAnchor) {
      return {
        ok: false,
        feedId: req.feedId,
        errorCode: 'anchor-not-found',
        errorMessage: `anchor message ${req.anchor.messageId} not found in feed ${req.feedId}`,
      }
    }

    const startIndex = Math.max(0, resolvedAnchor.index - req.before)
    const endIndex = Math.min(total - 1, resolvedAnchor.index + req.after)
    const messages = all.slice(startIndex, endIndex + 1)
    const anchorMessage = all[resolvedAnchor.index]

    return {
      ok: true,
      anchor: {
        messageId: anchorMessage?.id ?? '',
        position: anchorMessage?.sequence,
      },
      anchorStatus: resolvedAnchor.status,
      feedId: req.feedId,
      hasMoreAfter: endIndex < total - 1,
      hasMoreBefore: startIndex > 0,
      total,
      messages,
    }
  }

  resetScenario(initialScenario)

  return {
    api: {
      getLatestMessages,
      getMessagesAround,
    },
    storage: {
      loadPersistedDemoFeed,
      savePersistedDemoFeed,
      writeDemoLog: async () => undefined,
    },
    resetScenario,
  }
}

function createSeedFeed(scenario: E2EScenarioDefinition): PersistedDemoFeed {
  return {
    version: 1,
    feedId: scenario.feedId,
    revision: 1,
    hasMoreBefore: scenario.seedCount > 0,
    lastViewportAnchor: undefined,
    messages: createDemoMessages(scenario.seedCount, scenario.feedId),
    updatedAt: E2E_SEED_UPDATED_AT,
  }
}

function resolveAnchor(
  messages: DemoMessage[],
  anchor: MessageIdentityAnchor,
): { index: number; status: MessagesAroundOkResp['anchorStatus'] } | null {
  const directIndex = messages.findIndex(
    (message) => message.id === anchor.messageId,
  )

  if (directIndex >= 0) {
    return {
      index: directIndex,
      status: 'normal',
    }
  }

  if (!Number.isFinite(anchor.position)) {
    return null
  }

  const targetPosition = anchor.position as number
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]

    if (!message) {
      continue
    }

    const distance = Math.abs(message.sequence - targetPosition)

    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }

  if (nearestIndex < 0) {
    return null
  }

  return {
    index: nearestIndex,
    status: 'deleted',
  }
}

function cloneFeed(feed: PersistedDemoFeed): PersistedDemoFeed {
  return JSON.parse(JSON.stringify(feed)) as PersistedDemoFeed
}
