import type {
  LoadedSegment,
  MessageIdentityAnchor,
  MessageListRuntime,
  MessageRuntimeItemKey,
  ResetAroundAlign,
} from '../../runtime'
import type { MessageListDataRuntime } from '../../runtime/data'
import {
  createDemoMessages,
  toDemoMessageDataItem,
  type DemoMessage,
} from '../demoData'
import { DEMO_FEEDS, getDemoFeedDefinition } from '../demoFeeds'
import {
  readDemoViewportAnchor,
  readDemoFeedMessages,
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
  align?: ResetAroundAlign
  offsetWithinMessage?: number
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
    align: input.align,
    offsetWithinMessage: input.offsetWithinMessage,
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

export function selectDemoFeed(input: {
  feedId: string
  activeFeedId: string
  selectedFeedId: string
  activeFeedIdRef: { current: string }
  savedAnchorsRef: { current: Map<string, SavedRuntimeAnchor> }
  deferredSessionResponseDelayMsRef: { current: number }
  pageSize: number
  runtimeCache: DemoFeedRuntimeCache
  getDataRuntime: (feedId: string) => MessageListDataRuntime<DemoMessage>
  publishSegment: (dataRuntime: MessageListDataRuntime<DemoMessage>) => void
  stopLongRunningMocks: () => void
  resetSessionLoadingOverlay: () => void
  setEdgeLoading: (edge: 'before' | 'after', loading: boolean) => void
  setActiveFeedId: (feedId: string) => void
  setSelectedFeedId: (feedId: string) => void
  setPendingFeedId: (feedId: string | null) => void
  setFeedLoading: (loading: boolean) => void
  setMessages: (messages: DemoMessage[]) => void
  setMessageCount: (messageCount: number) => void
  setLastEvent: (eventText: string) => void
}): void {
  const { feedId } = input

  if (feedId === input.selectedFeedId) {
    return
  }

  if (feedId === input.activeFeedId) {
    input.setSelectedFeedId(feedId)
    input.setPendingFeedId(null)
    input.setFeedLoading(false)
    return
  }

  input.stopLongRunningMocks()
  input.resetSessionLoadingOverlay()
  input.setSelectedFeedId(feedId)
  input.setEdgeLoading('before', false)
  input.setEdgeLoading('after', false)

  const warmRuntime = input.runtimeCache.hasRuntime(feedId)
    ? input.runtimeCache.getRuntime(feedId)
    : null
  if (warmRuntime && warmRuntime.getSnapshot().items.length > 0) {
    activateSelectedFeed(input, feedId)
    return
  }

  if (input.deferredSessionResponseDelayMsRef.current === 0) {
    const prepared = prepareSynchronousFeedActivation({
      feedId,
      pageSize: input.pageSize,
      dataRuntime: input.getDataRuntime(feedId),
      publishSegment: input.publishSegment,
    })
    if (prepared.savedAnchor) {
      input.savedAnchorsRef.current.set(feedId, prepared.savedAnchor)
    }
    activateSelectedFeed(input, feedId)
    input.setMessages(prepared.messages)
    input.setMessageCount(prepared.messageCount)
    const feedTitle = getDemoFeedDefinition(feedId).title
    input.setLastEvent(
      prepared.savedAnchor
        ? `restored ${feedTitle}`
        : `loaded ${feedTitle}`,
    )
    return
  }

  input.setPendingFeedId(feedId)
  input.setFeedLoading(true)
}

function activateSelectedFeed(
  input: Pick<
    Parameters<typeof selectDemoFeed>[0],
    | 'activeFeedIdRef'
    | 'setActiveFeedId'
    | 'setPendingFeedId'
    | 'setFeedLoading'
  >,
  feedId: string,
): void {
  input.activeFeedIdRef.current = feedId
  input.setActiveFeedId(feedId)
  input.setPendingFeedId(null)
  input.setFeedLoading(false)
}

export function prepareSynchronousFeedActivation(input: {
  feedId: string
  pageSize: number
  dataRuntime: MessageListDataRuntime<DemoMessage>
  publishSegment: (dataRuntime: MessageListDataRuntime<DemoMessage>) => void
}): {
  messages: DemoMessage[]
  messageCount: number
  savedAnchor?: SavedRuntimeAnchor
} {
  const feedMessages = readDemoFeedMessages(input.feedId)
  const persistedAnchor = readDemoViewportAnchor(input.feedId)
  const persistedRuntimeAnchor = persistedAnchor
    ? toRuntimeAnchor(input.feedId, persistedAnchor.messageId)
    : undefined
  const resolvedTarget = persistedAnchor
    ? resolvePersistedAnchorTarget(
        feedMessages,
        persistedAnchor.messageId,
        persistedAnchor.position,
      )
    : null

  if (persistedRuntimeAnchor && resolvedTarget) {
    const before = Math.floor(input.pageSize / 2)
    const after = Math.ceil(input.pageSize / 2)
    const start = Math.max(0, resolvedTarget.index - before)
    const end = Math.min(feedMessages.length, resolvedTarget.index + after + 1)
    const resolvedAnchor = toRuntimeAnchor(
      input.feedId,
      feedMessages[resolvedTarget.index]?.id,
    )
    input.dataRuntime.resetAround({
      target: persistedRuntimeAnchor,
      items: feedMessages.slice(start, end).map(toDemoMessageDataItem),
      hasMoreBefore: start > 0,
      hasMoreAfter: end < feedMessages.length,
      anchor: resolvedAnchor,
      anchorStatus: resolvedTarget.status,
      align: 'start',
      offsetWithinMessage: persistedAnchor.offsetWithinMessage,
    })
    input.publishSegment(input.dataRuntime)
    return {
      messages: input.dataRuntime.getSegment().items
        .map((item) => item.message)
        .filter((message): message is DemoMessage => Boolean(message)),
      messageCount: feedMessages.length,
      savedAnchor: {
        anchor: persistedRuntimeAnchor,
        offsetWithinMessage: persistedAnchor.offsetWithinMessage,
      },
    }
  }

  const latest = feedMessages.slice(Math.max(0, feedMessages.length - input.pageSize))
  input.dataRuntime.resetLatest({
    items: latest.map(toDemoMessageDataItem),
    hasMoreBefore: feedMessages.length > input.pageSize,
    hasMoreAfter: false,
    anchor: toRuntimeAnchor(input.feedId, latest.at(-1)?.id),
    anchorStatus: 'normal',
  })
  input.publishSegment(input.dataRuntime)
  return {
    messages: latest,
    messageCount: feedMessages.length,
  }
}

function resolvePersistedAnchorTarget(
  feedMessages: DemoMessage[],
  messageId: string,
  position: number | undefined,
): { index: number; status: 'normal' | 'deleted' } | null {
  const exactIndex = feedMessages.findIndex((message) => message.id === messageId)

  if (exactIndex >= 0) {
    return { index: exactIndex, status: 'normal' }
  }

  if (!Number.isFinite(position)) {
    return null
  }

  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  const targetPosition = position as number

  for (let index = 0; index < feedMessages.length; index += 1) {
    const distance = Math.abs(feedMessages[index].sequence - targetPosition)

    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }

  return nearestIndex >= 0
    ? { index: nearestIndex, status: 'deleted' }
    : null
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
