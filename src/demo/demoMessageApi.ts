import type {
  CommittedMessageDataItem,
  MessageDataSnapshot,
  ViewportEffect,
} from '../runtime/types'
import type { DemoMessage } from './demoData'
import { estimateDemoMessageHeight } from './demoData'
import { loadPersistedDemoFeed } from './demoLocalStoreClient'
import type {
  GetLatestMessagesReq,
  GetLatestMessagesResp,
  GetMessagesAroundReq,
  GetMessagesAroundResp,
  MessageIdentityAnchor,
  MessagesAroundOkResp,
} from './demoMessageApiTypes'

const DEFAULT_LATEST_LIMIT = 40

/**
 * 获取 feed 最新的 N 条消息（首屏到底）。
 * 等价于真实 IM 的 getLatestMessages BFF 调用。
 */
export async function getLatestMessages(
  req: GetLatestMessagesReq,
): Promise<GetLatestMessagesResp<DemoMessage>> {
  const feed = await loadPersistedDemoFeed(req.feedId)

  if (!feed) {
    return {
      ok: false,
      feedId: req.feedId,
      errorCode: 'feed-not-found',
      errorMessage: `feed ${req.feedId} not found in local store`,
    }
  }

  const all = feed.messages
  const total = all.length
  const limit = req.limit ?? DEFAULT_LATEST_LIMIT

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
    anchor: { messageId: lastMessage.id, position: lastMessage.sequence },
    anchorStatus: 'normal',
    feedId: req.feedId,
    hasMoreAfter: false,
    hasMoreBefore: total > limit,
    total,
    messages,
  }
}

/**
 * 以 anchor 为中心获取 before + after 窗口的消息。
 * 等价于真实 IM 的 getMessagesAround BFF 调用。
 */
export async function getMessagesAround(
  req: GetMessagesAroundReq,
): Promise<GetMessagesAroundResp<DemoMessage>> {
  const feed = await loadPersistedDemoFeed(req.feedId)

  if (!feed) {
    return {
      ok: false,
      feedId: req.feedId,
      errorCode: 'feed-not-found',
      errorMessage: `feed ${req.feedId} not found in local store`,
    }
  }

  const all = feed.messages
  const total = all.length

  if (total === 0) {
    return {
      ok: false,
      feedId: req.feedId,
      errorCode: 'empty-feed',
      errorMessage: `feed ${req.feedId} has no messages`,
    }
  }

  const anchorIndex = all.findIndex(
    (message) => message.id === req.anchor.messageId,
  )

  if (anchorIndex === -1) {
    return {
      ok: false,
      feedId: req.feedId,
      errorCode: 'anchor-not-found',
      errorMessage: `anchor message ${req.anchor.messageId} not found in feed ${req.feedId}`,
    }
  }

  const startIndex = Math.max(0, anchorIndex - req.before)
  const endIndex = Math.min(total - 1, anchorIndex + req.after)
  const messages = all.slice(startIndex, endIndex + 1)

  const anchorMessage = all[anchorIndex]

  return {
    ok: true,
    anchor: {
      messageId: anchorMessage.id,
      position: anchorMessage.sequence,
    },
    anchorStatus: 'normal',
    feedId: req.feedId,
    hasMoreAfter: endIndex < total - 1,
    hasMoreBefore: startIndex > 0,
    total,
    messages,
  }
}

/**
 * 将 BFF ok response 转换为 runtime 需要的 MessageDataSnapshot。
 */
export function messagesAroundRespToSnapshot<TMessage>(
  resp: MessagesAroundOkResp<TMessage>,
  options: {
    generation: number
    revision: number
    toCommittedItem: (message: TMessage) => CommittedMessageDataItem<TMessage>
    effect: ViewportEffect
    snapshotKind: MessageDataSnapshot['change']['kind']
  },
): MessageDataSnapshot<TMessage> {
  return {
    feedId: resp.feedId,
    generation: options.generation,
    revision: options.revision,
    items: resp.messages.map(options.toCommittedItem),
    anchor: resp.anchor.messageId
      ? { messageId: resp.anchor.messageId, position: resp.anchor.position }
      : undefined,
    anchorStatus: resp.anchorStatus,
    hasMoreBefore: resp.hasMoreBefore,
    hasMoreAfter: resp.hasMoreAfter,
    change: {
      kind: options.snapshotKind,
      viewportEffect: options.effect,
    },
  }
}

/**
 * 将 DemoMessage 转为 CommittedMessageDataItem，供 messagesAroundRespToSnapshot 使用。
 */
export function toCommittedItem(
  message: DemoMessage,
): CommittedMessageDataItem<DemoMessage> {
  return {
    kind: 'committed',
    key: { kind: 'committed', messageId: message.id },
    message,
    version: message.expanded ? 2 : 1,
    contentVersion: message.expanded ? 2 : 1,
    estimatedHeight: estimateDemoMessageHeight(message),
  }
}

/**
 * 从 ok response 中提取最后一个消息作为 anchor（带 position）。
 */
export function getDemoRespAnchor(
  resp: MessagesAroundOkResp<DemoMessage>,
): MessageIdentityAnchor {
  const lastMessage = resp.messages[resp.messages.length - 1]
  return lastMessage
    ? { messageId: lastMessage.id, position: lastMessage.sequence }
    : resp.anchor
}
