import { useCallback } from 'react'
import {
  flushDemoFeedPersistence,
  replaceDemoFeedMessages,
} from '../data/demoMessageApi'
import type { DemoMessage } from '../data/demoData'
import type { AdvancedMockPublishResult } from '../mocks/demoAdvancedMockScenarios'
import {
  resolveChangedMessageKeys,
  resolveLoadedBounds,
} from './demoScenarioHelpers'

type DemoSegmentPublisherOptions = {
  appendRows: (
    feedId: string,
    rows: DemoMessage[],
    follow?: 'follow' | 'preserve',
  ) => void
  replaceRows: (input: {
    feedId: string
    rows: DemoMessage[]
    changedKeys: string[]
    hasMoreBefore?: boolean
    hasMoreAfter?: boolean
    anchor?: import('../../index').MessageListAnchor
    anchorStatus?: 'normal' | 'deleted' | 'unavailable' | 'permission'
  }) => void
  isActiveFeed: (feedId: string) => boolean
  setMessageCount: (messageCount: number) => void
  setLastEvent: (eventText: string) => void
}

export function useDemoSegmentPublisher({
  appendRows,
  replaceRows,
  isActiveFeed,
  setMessageCount,
  setLastEvent,
}: DemoSegmentPublisherOptions) {
  const publishActiveAppend = useCallback((
    feedId: string,
    items: DemoMessage[],
    follow?: 'follow' | 'preserve',
  ) => {
    appendRows(feedId, items, follow)
  }, [appendRows])

  const replaceLoadedMessages = useCallback(async (input: {
    feedId: string
    feedMessages: DemoMessage[]
    messages: DemoMessage[]
    changedKeys: string[]
    eventText: string
  }) => {
    const persistedMessages = replaceDemoFeedMessages(input.feedId, input.feedMessages)
    await flushDemoFeedPersistence(input.feedId)
    const bounds = resolveLoadedBounds(input.feedMessages, input.messages)

    if (input.changedKeys.length > 0) {
      replaceRows({
        feedId: input.feedId,
        rows: input.messages,
        changedKeys: input.changedKeys,
        hasMoreBefore: bounds.hasMoreBefore,
        hasMoreAfter: bounds.hasMoreAfter,
      })
    }

    if (isActiveFeed(input.feedId)) {
      setMessageCount(persistedMessages.length)
      setLastEvent(input.eventText)
    }
  }, [
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
    if (result.kind === 'append') {
      const previousIds = new Set(previousMessages.map((message) => message.id))
      const appendedMessages = result.messages.filter((message) =>
        !previousIds.has(message.id)
      )
      const persistedMessages = replaceDemoFeedMessages(feedId, result.feedMessages)
      await flushDemoFeedPersistence(feedId)

      if (appendedMessages.length > 0) {
        appendRows(feedId, appendedMessages)
      }

      if (isActiveFeed(feedId)) {
        setMessageCount(persistedMessages.length)
        setLastEvent(result.eventText)
      }
      return
    }

    await replaceLoadedMessages({
      feedId,
      feedMessages: result.feedMessages,
      messages: result.messages,
      changedKeys: resolveChangedMessageKeys(previousMessages, result.messages),
      eventText: result.eventText,
    })
  }, [
    appendRows,
    isActiveFeed,
    replaceLoadedMessages,
    setLastEvent,
    setMessageCount,
  ])

  return {
    publishActiveAppend,
    replaceLoadedMessages,
    applyAdvancedMockResult,
  }
}
