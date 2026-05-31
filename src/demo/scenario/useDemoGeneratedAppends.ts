import { useCallback } from 'react'
import {
  appendDemoFeedMessages,
  flushDemoFeedPersistence,
  loadDemoFeedMessages,
} from '../data/demoMessageApi'
import type { DemoMessage } from '../data/demoData'
import {
  applyLongBurstShape,
  createMockNewestMessages,
  waitMockDelay,
} from './demoScenarioHelpers'

export function useDemoGeneratedAppends(input: {
  activeFeedId: string
  appendDelayBaseMs: number
  getHasMoreAfter: () => boolean
  isActiveFeed: (feedId: string) => boolean
  longBurstDelayBaseMs: number
  longBurstSize: number
  publishActivePatch: (feedId: string, items: DemoMessage[]) => void
  setLastEvent: (eventText: string) => void
  setMessageCount: (messageCount: number) => void
}): {
  appendMessage: () => void
  appendMessages: (count: number) => void
  appendLongBurst: () => void
} {
  const {
    activeFeedId,
    appendDelayBaseMs,
    getHasMoreAfter,
    isActiveFeed,
    longBurstDelayBaseMs,
    longBurstSize,
    publishActivePatch,
    setLastEvent,
    setMessageCount,
  } = input

  const appendGeneratedMessages = useCallback(async (
    feedId: string,
    count: number,
    options: {
      delayBaseMs?: number
      forceLongBurstRow?: boolean
    } = {},
  ): Promise<{ messages: DemoMessage[]; visibleInCurrentWindow: boolean }> => {
    await waitMockDelay(options.delayBaseMs ?? appendDelayBaseMs)
    const allMessages = await loadDemoFeedMessages(feedId)
    const visibleInCurrentWindow = !getHasMoreAfter()
    const generatedMessages = createMockNewestMessages({
      feedId,
      count,
      existingMessages: allMessages,
    })
    const nextMessages = options.forceLongBurstRow
      ? applyLongBurstShape(generatedMessages)
      : generatedMessages
    const persistedMessages = appendDemoFeedMessages(feedId, nextMessages)

    await flushDemoFeedPersistence(feedId)
    if (isActiveFeed(feedId)) {
      setMessageCount(persistedMessages.length)
    }
    if (visibleInCurrentWindow) {
      publishActivePatch(feedId, nextMessages)
    }
    return { messages: nextMessages, visibleInCurrentWindow }
  }, [
    appendDelayBaseMs,
    getHasMoreAfter,
    isActiveFeed,
    publishActivePatch,
    setMessageCount,
  ])

  const appendMessage = useCallback(() => {
    void appendGeneratedMessages(activeFeedId, 1).then((result) => {
      if (!isActiveFeed(activeFeedId)) {
        return
      }
      const message = result.messages[0]

      setLastEvent(
        result.visibleInCurrentWindow
          ? `appended ${message?.id ?? 'message'}`
          : `queued ${message?.id ?? 'message'} after current window`,
      )
    })
  }, [activeFeedId, appendGeneratedMessages, isActiveFeed, setLastEvent])

  const appendMessages = useCallback((count: number) => {
    void appendGeneratedMessages(activeFeedId, Math.min(Math.max(1, count), 160))
      .then((result) => {
        if (!isActiveFeed(activeFeedId)) {
          return
        }
        setLastEvent(
          result.visibleInCurrentWindow
            ? `appended ${result.messages.length} messages`
            : `queued ${result.messages.length} messages after current window`,
        )
      })
  }, [activeFeedId, appendGeneratedMessages, isActiveFeed, setLastEvent])

  const appendLongBurst = useCallback(() => {
    void appendGeneratedMessages(activeFeedId, longBurstSize, {
      delayBaseMs: longBurstDelayBaseMs,
      forceLongBurstRow: true,
    }).then((result) => {
      if (!isActiveFeed(activeFeedId)) {
        return
      }
      setLastEvent(
        result.visibleInCurrentWindow
          ? `appended long burst ${result.messages.length}`
          : `queued long burst ${result.messages.length} after current window`,
      )
    })
  }, [
    activeFeedId,
    appendGeneratedMessages,
    isActiveFeed,
    longBurstDelayBaseMs,
    longBurstSize,
    setLastEvent,
  ])

  return { appendMessage, appendMessages, appendLongBurst }
}
