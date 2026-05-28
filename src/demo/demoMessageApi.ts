import {
  createDemoMessages,
  normalizeDemoMessages,
  type DemoMessage,
} from './demoData'
import { getDemoFeedDefinition } from './demoFeeds'
import {
  loadPersistedDemoFeed,
  savePersistedDemoFeed,
  type PersistedDemoFeed,
} from './demoLocalStoreClient'
import type {
  GetLatestMessagesReq,
  GetLatestMessagesResp,
  GetMessagesAroundReq,
  GetMessagesAroundResp,
  MessageIdentityAnchor,
  MessagesAroundOkResp,
} from './demoMessageApiTypes'

const DEFAULT_LATEST_LIMIT = 40
const feedStore = new Map<string, PersistedDemoFeed>()
const hydratedFeeds = new Set<string>()
const pendingWrites = new Map<string, Promise<void>>()

export async function getLatestMessages(
  req: GetLatestMessagesReq,
): Promise<GetLatestMessagesResp<DemoMessage>> {
  const feed = await ensureFeed(req.feedId)
  const all = feed.messages
  const total = all.length
  const limit = req.count ?? DEFAULT_LATEST_LIMIT

  if (total === 0) {
    return {
      ok: true,
      anchor: { messageId: '' },
      anchorStatus: 'normal',
      feedId: req.feedId,
      hasMoreAfter: false,
      hasMoreBefore: false,
      total,
      messages: [],
    }
  }

  const messages = all.slice(Math.max(0, total - limit))
  const anchor = getDemoRespAnchor({
    ok: true,
    feedId: req.feedId,
    anchor: { messageId: '' },
    anchorStatus: 'normal',
    hasMoreBefore: total > limit,
    hasMoreAfter: false,
    total,
    messages,
  })

  return {
    ok: true,
    anchor,
    anchorStatus: 'normal',
    feedId: req.feedId,
    hasMoreAfter: false,
    hasMoreBefore: total > limit,
    total,
    messages,
  }
}

export async function getMessagesAround(
  req: GetMessagesAroundReq,
): Promise<GetMessagesAroundResp<DemoMessage>> {
  const feed = await ensureFeed(req.feedId)
  const all = feed.messages

  if (all.length === 0) {
    return {
      ok: false,
      feedId: req.feedId,
      errorCode: 'empty-feed',
      errorMessage: `feed ${req.feedId} has no messages`,
    }
  }

  const resolved = resolveAnchor(all, req.anchor)

  if (!resolved) {
    return {
      ok: false,
      feedId: req.feedId,
      errorCode: 'anchor-not-found',
      errorMessage: `anchor ${req.anchor.messageId} not found`,
    }
  }

  const startIndex = Math.max(0, resolved.index - req.before)
  const endIndex = Math.min(all.length - 1, resolved.index + req.after)
  const messages = all.slice(startIndex, endIndex + 1)

  return {
    ok: true,
    anchor: {
      messageId: all[resolved.index].id,
      position: all[resolved.index].sequence,
    },
    anchorStatus: resolved.status,
    feedId: req.feedId,
    hasMoreAfter: endIndex < all.length - 1,
    hasMoreBefore: startIndex > 0,
    total: all.length,
    messages,
  }
}

export function getDemoRespAnchor(
  resp: MessagesAroundOkResp<DemoMessage>,
): MessageIdentityAnchor {
  const lastMessage = resp.messages[resp.messages.length - 1]
  return lastMessage
    ? { messageId: lastMessage.id, position: lastMessage.sequence }
    : resp.anchor
}

export function replaceDemoFeedMessages(
  feedId: string,
  messages: DemoMessage[],
): DemoMessage[] {
  return writeFeedMessages(feedId, messages).messages
}

export function readDemoFeedMessages(feedId: string): DemoMessage[] {
  return [...ensureFeedSync(feedId).messages]
}

export async function loadDemoFeedMessages(feedId: string): Promise<DemoMessage[]> {
  return [...(await ensureFeed(feedId)).messages]
}

export function readDemoViewportAnchor(
  feedId: string,
): PersistedDemoFeed['lastViewportAnchor'] | undefined {
  return feedStore.get(feedId)?.lastViewportAnchor
}

export async function loadDemoViewportAnchor(
  feedId: string,
): Promise<PersistedDemoFeed['lastViewportAnchor'] | undefined> {
  return (await ensureFeed(feedId)).lastViewportAnchor
}

export function saveDemoViewportAnchor(
  feedId: string,
  anchor: PersistedDemoFeed['lastViewportAnchor'] | undefined,
): void {
  const current = feedStore.get(feedId)

  if (!current) {
    return
  }

  const nextFeed = normalizePersistedFeed(feedId, {
    ...current,
    lastViewportAnchor: anchor,
    updatedAt: new Date().toISOString(),
  })

  feedStore.set(feedId, nextFeed)
  if (hydratedFeeds.has(feedId)) {
    void persistFeed(nextFeed)
  }
}

export function appendDemoFeedMessages(
  feedId: string,
  messages: DemoMessage[],
): DemoMessage[] {
  const next = normalizeDemoMessages(feedId, [
    ...ensureFeedSync(feedId).messages,
    ...messages,
  ])
  writeFeedMessages(feedId, next)
  return next
}

export async function flushDemoFeedPersistence(feedId?: string): Promise<void> {
  if (feedId) {
    await pendingWrites.get(feedId)
    return
  }

  await Promise.all(pendingWrites.values())
}

async function ensureFeed(feedId: string): Promise<PersistedDemoFeed> {
  const existing = feedStore.get(feedId)

  if (existing && hydratedFeeds.has(feedId)) {
    return existing
  }

  const persisted = await loadPersistedDemoFeed(feedId)

  if (persisted) {
    const normalized = normalizePersistedFeed(feedId, persisted)
    feedStore.set(feedId, normalized)
    hydratedFeeds.add(feedId)
    return normalized
  }

  const seeded = existing ?? createSeedFeed(feedId)
  feedStore.set(feedId, seeded)
  hydratedFeeds.add(feedId)
  await persistFeed(seeded)
  return seeded
}

function ensureFeedSync(feedId: string): PersistedDemoFeed {
  const existing = feedStore.get(feedId)

  if (existing) {
    return existing
  }

  const seeded = createSeedFeed(feedId)
  feedStore.set(feedId, seeded)
  return seeded
}

function writeFeedMessages(feedId: string, messages: DemoMessage[]): PersistedDemoFeed {
  const current = feedStore.get(feedId)
  const nextFeed = normalizePersistedFeed(feedId, {
    version: 1,
    feedId,
    revision: (current?.revision ?? 0) + 1,
    hasMoreBefore: messages.length > 0 && (current?.hasMoreBefore ?? true),
    lastViewportAnchor: current?.lastViewportAnchor,
    messages,
    updatedAt: new Date().toISOString(),
  })

  feedStore.set(feedId, nextFeed)
  hydratedFeeds.add(feedId)
  void persistFeed(nextFeed)
  return nextFeed
}

function createSeedFeed(feedId: string): PersistedDemoFeed {
  const feed = getDemoFeedDefinition(feedId)
  const seeded = createDemoMessages(feed.seedCount, feedId)

  return {
    version: 1,
    feedId,
    revision: 1,
    hasMoreBefore: seeded.length > 0,
    messages: seeded,
    updatedAt: new Date().toISOString(),
  }
}

function normalizePersistedFeed(
  feedId: string,
  feed: PersistedDemoFeed,
): PersistedDemoFeed {
  return {
    version: 1,
    feedId,
    revision: Number.isFinite(feed.revision) ? feed.revision : 1,
    hasMoreBefore:
      typeof feed.hasMoreBefore === 'boolean'
        ? feed.hasMoreBefore
        : feed.messages.length > 0,
    lastViewportAnchor: feed.lastViewportAnchor,
    messages: normalizeDemoMessages(feedId, feed.messages),
    updatedAt: feed.updatedAt || new Date().toISOString(),
  }
}

async function persistFeed(feed: PersistedDemoFeed): Promise<void> {
  const previousWrite = pendingWrites.get(feed.feedId) ?? Promise.resolve()
  const nextWrite = previousWrite.then(
    () => savePersistedDemoFeed(feed),
    () => savePersistedDemoFeed(feed),
  )

  pendingWrites.set(
    feed.feedId,
    nextWrite.then(
      () => undefined,
      () => undefined,
    ),
  )
  await nextWrite
}

function resolveAnchor(
  messages: DemoMessage[],
  anchor: MessageIdentityAnchor,
): { index: number; status: 'normal' | 'deleted' } | null {
  const direct = messages.findIndex((message) => message.id === anchor.messageId)

  if (direct >= 0) {
    return { index: direct, status: 'normal' }
  }

  if (!Number.isFinite(anchor.position)) {
    return null
  }

  const targetPosition = anchor.position as number
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const distance = Math.abs(message.sequence - targetPosition)

    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }

  return nearestIndex >= 0
    ? { index: nearestIndex, status: 'deleted' }
    : null
}
