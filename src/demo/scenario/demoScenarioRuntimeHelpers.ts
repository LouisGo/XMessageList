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
