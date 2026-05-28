import { useCallback } from 'react'
import {
  appendDemoFeedMessages,
  flushDemoFeedPersistence,
  loadDemoFeedMessages,
} from '../demoMessageApi'
import type { DemoMessage } from '../demoData'
import {
  applyLongBurstShape,
  createMockNewestMessages,
  waitMockDelay,
} from './demoScenarioHelpers'
import type { DemoDataRuntimeGetter } from './demoScenarioTypes'

export function useDemoGeneratedAppends(input: {
  activeFeedId: string
  appendDelayBaseMs: number
  getDataRuntime: DemoDataRuntimeGetter
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
    getDataRuntime,
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
    const dataRuntime = getDataRuntime(feedId)
    const visibleInCurrentWindow = !dataRuntime.getSegment().hasMoreAfter
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
    if (feedId === activeFeedId) {
      setMessageCount(persistedMessages.length)
    }
    if (visibleInCurrentWindow) {
      publishActivePatch(feedId, nextMessages)
    }
    return { messages: nextMessages, visibleInCurrentWindow }
  }, [
    activeFeedId,
    appendDelayBaseMs,
    getDataRuntime,
    publishActivePatch,
    setMessageCount,
  ])

  const appendMessage = useCallback(() => {
    void appendGeneratedMessages(activeFeedId, 1).then((result) => {
      const message = result.messages[0]

      setLastEvent(
        result.visibleInCurrentWindow
          ? `appended ${message?.id ?? 'message'}`
          : `queued ${message?.id ?? 'message'} after current window`,
      )
    })
  }, [activeFeedId, appendGeneratedMessages, setLastEvent])

  const appendMessages = useCallback((count: number) => {
    void appendGeneratedMessages(activeFeedId, Math.min(Math.max(1, count), 160))
      .then((result) => {
        setLastEvent(
          result.visibleInCurrentWindow
            ? `appended ${result.messages.length} messages`
            : `queued ${result.messages.length} messages after current window`,
        )
      })
  }, [activeFeedId, appendGeneratedMessages, setLastEvent])

  const appendLongBurst = useCallback(() => {
    void appendGeneratedMessages(activeFeedId, longBurstSize, {
      delayBaseMs: longBurstDelayBaseMs,
      forceLongBurstRow: true,
    }).then((result) => {
      setLastEvent(
        result.visibleInCurrentWindow
          ? `appended long burst ${result.messages.length}`
          : `queued long burst ${result.messages.length} after current window`,
      )
    })
  }, [
    activeFeedId,
    appendGeneratedMessages,
    longBurstDelayBaseMs,
    longBurstSize,
    setLastEvent,
  ])

  return { appendMessage, appendMessages, appendLongBurst }
}
