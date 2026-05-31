import type {
  LoadedSegment,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from '../../x-message-list/core/runtime/index'
import type { MessageListResolvedAnchor } from '../../index'
import type { DemoMessage } from '../data/demoData'
import {
  readDemoViewportAnchor,
} from '../data/demoMessageApi'

export const RANDOM_CHAT_FEED_ID = 'feed-random'
const RANDOM_CHAT_SLOW_DELAY_MS = 340
const RANDOM_CHAT_FAST_DELAY_MS = 150

export type SavedRuntimeAnchor = {
  anchor: MessageListResolvedAnchor
  offsetWithinMessage?: number
}

export function resolveTrimProtectKey(
  segment: LoadedSegment<DemoMessage>,
  anchor: MessageIdentityAnchor | null,
  shouldProtectTail: boolean,
): MessageRuntimeItemKey | undefined {
  if (segment.modifier.type === 'extend-before') {
    return segment.items[0]?.key
  }

  if (segment.modifier.type === 'extend-after') {
    return segment.items.at(-1)?.key
  }

  if (shouldProtectTail) {
    return segment.items.at(-1)?.key
  }

  const anchorKey = anchor ? findKeyForAnchor(segment, anchor) : undefined
  if (anchorKey) {
    return anchorKey
  }

  const segmentAnchorKey = segment.anchor
    ? findKeyForAnchor(segment, segment.anchor)
    : undefined
  if (segmentAnchorKey) {
    return segmentAnchorKey
  }

  if (
    segment.modifier.type === 'reset-latest' ||
    !segment.hasMoreAfter
  ) {
    return segment.items.at(-1)?.key
  }

  return segment.items[Math.floor(segment.items.length / 2)]?.key
}

export function toPersistedViewportAnchor(
  anchor: MessageListResolvedAnchor,
  feedMessages: DemoMessage[],
  offsetWithinMessage = 0,
): ReturnType<typeof readDemoViewportAnchor> {
  const messageId = anchor.serverId ?? anchor.stableId ?? anchor.localId

  if (!messageId) {
    return undefined
  }

  const message = feedMessages.find((candidate) => candidate.id === messageId)

  return {
    messageId,
    position: message?.sequence,
    offsetWithinMessage,
  }
}

export function resolveDemoSessionDelayMs(feedId: string): number {
  if (feedId !== RANDOM_CHAT_FEED_ID) {
    return 0
  }

  const roll = Math.random()

  if (roll < 0.5) {
    return RANDOM_CHAT_SLOW_DELAY_MS
  }

  if (roll < 0.8) {
    return RANDOM_CHAT_FAST_DELAY_MS
  }

  return 0
}

function findKeyForAnchor(
  segment: LoadedSegment<DemoMessage>,
  anchor: MessageIdentityAnchor,
): MessageRuntimeItemKey | undefined {
  return segment.items.find((item) => {
    const identity = item.identity

    return identity &&
      identity.feedId === anchor.feedId &&
      (
        identity.stableId === anchor.stableId ||
        Boolean(identity.serverId && identity.serverId === anchor.serverId) ||
        Boolean(identity.localId && identity.localId === anchor.localId)
      )
  })?.key
}
