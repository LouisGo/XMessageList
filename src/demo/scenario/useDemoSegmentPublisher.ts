import { useCallback } from 'react'
import type { MessageListDataRuntime } from '../../runtime/data/index'
import {
  flushDemoFeedPersistence,
  replaceDemoFeedMessages,
} from '../data/demoMessageApi'
import { toDemoMessageDataItem, type DemoMessage } from '../data/demoData'
import type { AdvancedMockPublishResult } from '../mocks/demoAdvancedMockScenarios'
import type { DemoFeedRuntimeCache } from '../runtime/useDemoFeedRuntimeCache'
import { DEMO_ITEM_BUDGET } from './demoScenarioConfig'
import {
  resolveChangedMessageKeys,
  resolveLoadedBounds,
} from './demoScenarioHelpers'
import { resolveTrimProtectKey } from './demoScenarioRuntimeHelpers'

type DemoSegmentPublisherOptions = {
  runtimeCache: DemoFeedRuntimeCache
  getDataRuntime: (feedId: string) => MessageListDataRuntime<DemoMessage>
  isActiveFeed: (feedId: string) => boolean
  setMessages: (messages: DemoMessage[]) => void
  setMessageCount: (messageCount: number) => void
  setLastEvent: (eventText: string) => void
}

export function useDemoSegmentPublisher({
  runtimeCache,
  getDataRuntime,
  isActiveFeed,
  setMessages,
  setMessageCount,
  setLastEvent,
}: DemoSegmentPublisherOptions) {
  const publishSegment = useCallback((
    dataRuntime: MessageListDataRuntime<DemoMessage>,
  ) => {
    const runtimeForFeed = runtimeCache.getRuntime(dataRuntime.getSegment().feedId)
    const committedSegment = dataRuntime.getSegment()
    runtimeForFeed.applyLoadedSegment(committedSegment)
    const shouldProtectTail =
      runtimeForFeed.getSnapshot().bottomLockState === 'LOCKED'
    let segment = committedSegment

    for (let trimGuard = 0; trimGuard < 4; trimGuard += 1) {
      const trimmed = dataRuntime.trimToBudget(resolveTrimProtectKey(
        segment,
        runtimeForFeed.getViewportAnchor(),
        shouldProtectTail,
      ))
      if (trimmed === segment) {
        break
      }
      segment = trimmed
      runtimeForFeed.applyLoadedSegment(segment)
      if (segment.items.length <= DEMO_ITEM_BUDGET) {
        break
      }
    }

    const nextMessages = segment.items
      .map((item) => item.message)
      .filter((message): message is DemoMessage => Boolean(message))
    if (isActiveFeed(segment.feedId)) {
      setMessages(nextMessages)
    }
  }, [isActiveFeed, runtimeCache, setMessages])

  const publishActivePatch = useCallback((
    feedId: string,
    items: DemoMessage[],
  ) => {
    const dataRuntime = getDataRuntime(feedId)
    dataRuntime.patchItems(items.map(toDemoMessageDataItem))
    publishSegment(dataRuntime)
  }, [getDataRuntime, publishSegment])

  const replaceLoadedMessages = useCallback(async (input: {
    feedId: string
    feedMessages: DemoMessage[]
    messages: DemoMessage[]
    changedKeys: string[]
    eventText: string
  }) => {
    const persistedMessages = replaceDemoFeedMessages(input.feedId, input.feedMessages)
    await flushDemoFeedPersistence(input.feedId)
    const dataRuntime = getDataRuntime(input.feedId)
    const currentSegment = dataRuntime.getSegment()
    const bounds = resolveLoadedBounds(input.feedMessages, input.messages)

    if (input.changedKeys.length > 0) {
      dataRuntime.replaceItems({
        items: input.messages.map(toDemoMessageDataItem),
        changedKeys: input.changedKeys,
        hasMoreBefore: bounds.hasMoreBefore ?? currentSegment.hasMoreBefore,
        hasMoreAfter: bounds.hasMoreAfter ?? currentSegment.hasMoreAfter,
        anchor: currentSegment.anchor,
        anchorStatus: currentSegment.anchorStatus,
      })
      publishSegment(dataRuntime)
    }

    if (isActiveFeed(input.feedId)) {
      setMessageCount(persistedMessages.length)
      setLastEvent(input.eventText)
    }
  }, [
    getDataRuntime,
    isActiveFeed,
    publishSegment,
    setLastEvent,
    setMessageCount,
  ])

  const applyAdvancedMockResult = useCallback(async (
    feedId: string,
    result: AdvancedMockPublishResult,
    previousMessages: DemoMessage[],
  ) => {
    await replaceLoadedMessages({
      feedId,
      feedMessages: result.feedMessages,
      messages: result.messages,
      changedKeys: resolveChangedMessageKeys(previousMessages, result.messages),
      eventText: result.eventText,
    })
  }, [replaceLoadedMessages])

  return {
    publishSegment,
    publishActivePatch,
    replaceLoadedMessages,
    applyAdvancedMockResult,
  }
}
