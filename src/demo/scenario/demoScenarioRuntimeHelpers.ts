import type {
  LoadedSegment,
  MessageIdentityAnchor,
  MessageListRuntime,
  MessageRuntimeItemKey,
} from '../../runtime'
import type { MessageListDataRuntime } from '../../runtime/data'
import {
  createDemoMessages,
  toDemoMessageDataItem,
  type DemoMessage,
} from '../demoData'
import { DEMO_FEEDS } from '../demoFeeds'
import {
  readDemoViewportAnchor,
  replaceDemoFeedMessages,
  saveDemoViewportAnchor,
} from '../demoMessageApi'
import {
  applyAroundRequest,
  toRuntimeAnchor,
} from '../demoScenarioRequests'
import type { DemoFeedRuntimeCache } from '../useDemoFeedRuntimeCache'
import {
  resolveScenarioTotalMessages,
  usesAroundBootstrap,
} from './demoScenarioHelpers'

export async function restoreAroundAnchor(input: {
  dataRuntime: MessageListDataRuntime<DemoMessage>
  runtime: MessageListRuntime<DemoMessage>
  publishSegment: (dataRuntime: MessageListDataRuntime<DemoMessage>) => void
  feedId: string
  pageSize: number
  target: MessageIdentityAnchor
}): Promise<Awaited<ReturnType<typeof applyAroundRequest>>> {
  const segment = input.dataRuntime.getSegment()
  return await applyAroundRequest({
    dataRuntime: input.dataRuntime,
    runtime: input.runtime,
    publishSegment: input.publishSegment,
    pageSize: input.pageSize,
    event: {
      type: 'needMessagesAround',
      feedId: input.feedId,
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      requestToken: `${input.feedId}:restore:${segment.generation}:${segment.segmentRevision}`,
      reason: 'restore',
      target: input.target,
    },
  })
}

export function resolveSavedRuntimeAnchor(
  feedId: string,
  savedAnchors: Map<string, SavedRuntimeAnchor>,
): SavedRuntimeAnchor | null {
  return savedAnchors.get(feedId) ?? null
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
  anchor: MessageIdentityAnchor,
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

export type SavedRuntimeAnchor = {
  anchor: MessageIdentityAnchor
  offsetWithinMessage?: number
}

export function prepareDemoE2EScenario(input: {
  scenarioId: string
  pageSize: number
  getDataRuntime: (feedId: string) => MessageListDataRuntime<DemoMessage>
  runtimeCache: DemoFeedRuntimeCache
}): {
  feedId: string
  runtime: MessageListRuntime<DemoMessage>
  segment: LoadedSegment<DemoMessage>
  messages: DemoMessage[]
  messageCount: number
  shouldScrollToLatest: boolean
} {
  const feedId = DEMO_FEEDS[0].id
  const allMessages = createDemoMessages(resolveScenarioTotalMessages(input.scenarioId), feedId)
  replaceDemoFeedMessages(feedId, allMessages)
  saveDemoViewportAnchor(feedId, undefined)

  const dataRuntime = input.getDataRuntime(feedId)
  const runtime = input.runtimeCache.getRuntime(feedId)
  const aroundBootstrap = usesAroundBootstrap(input.scenarioId)

  if (aroundBootstrap) {
    resetAroundScenario(input.scenarioId, feedId, allMessages, dataRuntime)
  } else {
    const latest = allMessages.slice(Math.max(0, allMessages.length - input.pageSize))
    dataRuntime.resetLatest({
      items: latest.map(toDemoMessageDataItem),
      hasMoreBefore: allMessages.length > input.pageSize,
      hasMoreAfter: false,
      anchor: toRuntimeAnchor(feedId, latest.at(-1)?.id),
      anchorStatus: 'normal',
    })
  }

  const segment = dataRuntime.getSegment()
  return {
    feedId,
    runtime,
    segment,
    messages: segment.items
      .map((item) => item.message)
      .filter((message): message is DemoMessage => Boolean(message)),
    messageCount: allMessages.length,
    shouldScrollToLatest: !aroundBootstrap,
  }
}

function resetAroundScenario(
  scenarioId: string,
  feedId: string,
  allMessages: DemoMessage[],
  dataRuntime: MessageListDataRuntime<DemoMessage>,
): void {
  const targetIndex = Math.floor(allMessages.length / 2)
  const target = allMessages[targetIndex] ?? allMessages[0]
  const before = scenarioId === 'underflow.dual-edge-arbitration' ? 1 : 8
  const after = scenarioId === 'underflow.dual-edge-arbitration' ? 1 : 8
  const start = Math.max(0, targetIndex - before)
  const end = Math.min(allMessages.length, targetIndex + after + 1)

  dataRuntime.resetAround({
    target: {
      feedId,
      stableId: target.id,
      serverId: target.id,
    },
    items: allMessages.slice(start, end).map(toDemoMessageDataItem),
    hasMoreBefore: start > 0,
    hasMoreAfter: end < allMessages.length,
    anchor: {
      feedId,
      stableId: target.id,
      serverId: target.id,
    },
    anchorStatus: 'normal',
  })
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
