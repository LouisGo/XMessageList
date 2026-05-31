import { useCallback } from 'react'
import type { MessageListDataRuntime } from '../../x-message-list/core/runtime/data/index'
import {
  flushDemoFeedPersistence,
  replaceDemoFeedMessages,
} from '../data/demoMessageApi'
import type { DemoMessage } from '../data/demoData'
import type { AdvancedMockPublishResult } from '../mocks/demoAdvancedMockScenarios'
import { DEMO_ITEM_BUDGET } from './demoScenarioConfig'
import {
  resolveChangedMessageKeys,
  resolveLoadedBounds,
} from './demoScenarioHelpers'
import { resolveTrimProtectKey } from './demoScenarioRuntimeHelpers'

type DemoSegmentPublisherOptions = {
  getRuntime: (
    feedId: string,
  ) => import('../../x-message-list/core/runtime/index').MessageListRuntime<DemoMessage>
  patchRows: (feedId: string, rows: DemoMessage[]) => void
  replaceRows: (input: {
    feedId: string
    rows: DemoMessage[]
    changedKeys: string[]
    hasMoreBefore?: boolean
    hasMoreAfter?: boolean
    anchor?: import('../../index').MessageListAnchor
    anchorStatus?: 'normal' | 'deleted' | 'unavailable' | 'permission'
  }) => void
  getDataRuntime: (feedId: string) => MessageListDataRuntime<DemoMessage>
  isActiveFeed: (feedId: string) => boolean
  setMessages: (messages: DemoMessage[]) => void
  setMessageCount: (messageCount: number) => void
  setLastEvent: (eventText: string) => void
}

/**
 * 将 data runtime 的最新 LoadedSegment 发布给对应 viewport runtime，并在同一边界内处理 demo 的 trim 预算。
 */
export function useDemoSegmentPublisher({
  getRuntime,
  patchRows,
  replaceRows,
  getDataRuntime,
  isActiveFeed,
  setMessages,
  setMessageCount,
  setLastEvent,
}: DemoSegmentPublisherOptions) {
  const publishSegment = useCallback((
    dataRuntime: MessageListDataRuntime<DemoMessage>,
  ) => {
    const runtimeForFeed = getRuntime(dataRuntime.getSegment().feedId)
    const committedSegment = dataRuntime.getSegment()
    runtimeForFeed.applyLoadedSegment(committedSegment)
    const shouldProtectTail =
      runtimeForFeed.getSnapshot().bottomLockState === 'LOCKED'
    let segment = committedSegment

    // trim 可能连续产生新 segment；限制轮数防止异常数据让 demo publisher 自旋。
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
  }, [getRuntime, isActiveFeed, setMessages])

  const publishActivePatch = useCallback((
    feedId: string,
    items: DemoMessage[],
  ) => {
    patchRows(feedId, items)
    const dataRuntime = getDataRuntime(feedId)
    const nextMessages = dataRuntime.getSegment().items
      .map((item) => item.message)
      .filter((message): message is DemoMessage => Boolean(message))
    if (isActiveFeed(feedId)) {
      setMessages(nextMessages)
    }
  }, [getDataRuntime, isActiveFeed, patchRows, setMessages])

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
      replaceRows({
        feedId: input.feedId,
        rows: input.messages,
        changedKeys: input.changedKeys,
        hasMoreBefore: bounds.hasMoreBefore ?? currentSegment.hasMoreBefore,
        hasMoreAfter: bounds.hasMoreAfter ?? currentSegment.hasMoreAfter,
        anchor: currentSegment.anchor,
        anchorStatus: currentSegment.anchorStatus,
      })
    }

    if (isActiveFeed(input.feedId)) {
      setMessageCount(persistedMessages.length)
      setLastEvent(input.eventText)
    }
  }, [
    getDataRuntime,
    isActiveFeed,
    replaceRows,
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
