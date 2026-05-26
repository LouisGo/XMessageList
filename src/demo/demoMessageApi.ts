import {
  createDemoMessages,
  normalizeDemoMessages,
  type DemoMessage,
} from './demoData'
import { getDemoFeedDefinition } from './demoFeeds'
import type {
  GetLatestMessagesReq,
  GetLatestMessagesResp,
  GetMessagesAroundReq,
  GetMessagesAroundResp,
  MessageIdentityAnchor,
  MessagesAroundOkResp,
} from './demoMessageApiTypes'

const DEFAULT_LATEST_LIMIT = 40
const feedStore = new Map<string, DemoMessage[]>()

export async function getLatestMessages(
  req: GetLatestMessagesReq,
): Promise<GetLatestMessagesResp<DemoMessage>> {
  const all = ensureFeedMessages(req.feedId)
  const total = all.length
  const limit = req.count ?? DEFAULT_LATEST_LIMIT
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
  const all = ensureFeedMessages(req.feedId)

  if (all.length === 0) {
    return {
      ok: false,
      feedId: req.feedId,
      errorCode: 'empty-feed',
      errorMessage: `feed ${req.feedId} has no messages`,
    }
  }

  const resolved = resolveAnchor(all, req.anchor)

  if (resolved < 0) {
    return {
      ok: false,
      feedId: req.feedId,
      errorCode: 'anchor-not-found',
      errorMessage: `anchor ${req.anchor.messageId} not found`,
    }
  }

  const startIndex = Math.max(0, resolved - req.before)
  const endIndex = Math.min(all.length - 1, resolved + req.after)
  const messages = all.slice(startIndex, endIndex + 1)

  return {
    ok: true,
    anchor: {
      messageId: all[resolved].id,
      position: all[resolved].sequence,
    },
    anchorStatus: 'normal',
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
): void {
  feedStore.set(feedId, normalizeDemoMessages(feedId, messages))
}

function ensureFeedMessages(feedId: string): DemoMessage[] {
  const existing = feedStore.get(feedId)

  if (existing) {
    return existing
  }

  const feed = getDemoFeedDefinition(feedId)
  const seeded = createDemoMessages(feed.seedCount, feedId)
  feedStore.set(feedId, seeded)
  return seeded
}

function resolveAnchor(
  messages: DemoMessage[],
  anchor: MessageIdentityAnchor,
): number {
  const direct = messages.findIndex((message) => message.id === anchor.messageId)

  if (direct >= 0) {
    return direct
  }

  if (!Number.isFinite(anchor.position)) {
    return -1
  }

  return messages.reduce((best, message, index) => {
    const bestSequence = messages[best]?.sequence ?? Number.POSITIVE_INFINITY
    const bestDistance = Math.abs(bestSequence - (anchor.position as number))
    const nextDistance = Math.abs(message.sequence - (anchor.position as number))
    return nextDistance < bestDistance ? index : best
  }, 0)
}
