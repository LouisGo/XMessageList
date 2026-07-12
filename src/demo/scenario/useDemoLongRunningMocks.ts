import { useCallback, useRef, useState } from 'react'
import {
  type AdvancedMockEventStormState,
  type AdvancedMockPublishResult,
  applyBotPushTick,
  applyEventStormTick,
  createEventStormState,
  flushEventStormBuffer,
  getNextBotPushDelayMs,
  getNextEventStormDelayMs,
} from '../mocks/demoAdvancedMockScenarios'
import { loadDemoFeedMessages } from '../data/demoMessageApi'
import {
  createDemoRequestId,
  writeDemoLog,
  type DemoOperationName,
} from '../data/demoLocalStoreClient'
import type { DemoMessage } from '../data/demoData'

export type DemoLongRunningMockActions = {
  eventStormRunning: boolean
  botPushActive: boolean
  stopLongRunningMocks: () => void
  toggleEventStorm: () => void
  toggleBotPush: () => void
}

export function useDemoLongRunningMocks(input: {
  activeFeedId: string
  getHasMoreAfter: () => boolean
  getLoadedMessages: () => DemoMessage[]
  applyAdvancedMockResult: (
    feedId: string,
    result: AdvancedMockPublishResult,
    previousMessages: DemoMessage[],
  ) => Promise<void>
  setLastEvent: (eventText: string) => void
}): DemoLongRunningMockActions {
  const {
    activeFeedId,
    applyAdvancedMockResult,
    getHasMoreAfter,
    getLoadedMessages,
    setLastEvent,
  } = input
  const [eventStormRunning, setEventStormRunning] = useState(false)
  const [botPushActive, setBotPushActive] = useState(false)
  const eventStormTimerRef = useRef<number | null>(null)
  const botPushTimerRef = useRef<number | null>(null)
  const eventStormStateRef = useRef<AdvancedMockEventStormState | null>(null)
  const eventStormTokenRef = useRef(0)
  const botPushTokenRef = useRef(0)

  const stopEventStorm = useCallback(async (flushBuffered: boolean) => {
    if (eventStormTimerRef.current !== null) {
      window.clearTimeout(eventStormTimerRef.current)
      eventStormTimerRef.current = null
    }
    eventStormTokenRef.current += 1
    setEventStormRunning(false)

    if (!flushBuffered || !eventStormStateRef.current) {
      eventStormStateRef.current = null
      return
    }

    const previousMessages = getLoadedMessages()
    const feedMessages = await loadDemoFeedMessages(activeFeedId)
    const result = flushEventStormBuffer({
      feedId: activeFeedId,
      feedMessages,
      messages: previousMessages,
      hasMoreAfter: getHasMoreAfter(),
      state: eventStormStateRef.current,
    })
    eventStormStateRef.current = null

    if (result) {
      await applyAdvancedMockResult(activeFeedId, result, previousMessages)
      return
    }

    setLastEvent('event storm stopped')
  }, [
    activeFeedId,
    applyAdvancedMockResult,
    getHasMoreAfter,
    getLoadedMessages,
    setLastEvent,
  ])

  const stopBotPush = useCallback(() => {
    if (botPushTimerRef.current !== null) {
      window.clearTimeout(botPushTimerRef.current)
      botPushTimerRef.current = null
    }
    botPushTokenRef.current += 1
    setBotPushActive(false)
  }, [])

  const stopLongRunningMocks = useCallback(() => {
    void stopEventStorm(false)
    stopBotPush()
  }, [stopBotPush, stopEventStorm])

  const scheduleEventStormTick = useCallback(function schedule(
    feedId: string,
    token: number,
  ) {
    eventStormTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const state = eventStormStateRef.current
          if (eventStormTokenRef.current !== token || !state) return

          const previousMessages = getLoadedMessages()
          const feedMessages = await loadDemoFeedMessages(feedId)
          const result = applyEventStormTick({
            feedId,
            feedMessages,
            messages: previousMessages,
            hasMoreAfter: getHasMoreAfter(),
            state,
          })

          if (result) {
            await applyAdvancedMockResult(feedId, result, previousMessages)
          }
        } catch (error) {
          reportMockTickError('mock.eventStorm', feedId, error, setLastEvent)
        } finally {
          if (eventStormTokenRef.current === token && eventStormStateRef.current) {
            schedule(feedId, token)
          }
        }
      })()
    }, getNextEventStormDelayMs())
  }, [applyAdvancedMockResult, getHasMoreAfter, getLoadedMessages, setLastEvent])

  const scheduleBotPushTick = useCallback(function schedule(
    feedId: string,
    token: number,
  ) {
    botPushTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          if (botPushTokenRef.current !== token) return

          const previousMessages = getLoadedMessages()
          const feedMessages = await loadDemoFeedMessages(feedId)
          const result = applyBotPushTick({
            feedId,
            feedMessages,
            messages: previousMessages,
            hasMoreAfter: getHasMoreAfter(),
          })

          await applyAdvancedMockResult(feedId, result, previousMessages)
        } catch (error) {
          reportMockTickError('mock.botPush', feedId, error, setLastEvent)
        } finally {
          if (botPushTokenRef.current === token) {
            schedule(feedId, token)
          }
        }
      })()
    }, getNextBotPushDelayMs())
  }, [applyAdvancedMockResult, getHasMoreAfter, getLoadedMessages, setLastEvent])

  const toggleEventStorm = useCallback(() => {
    if (eventStormTimerRef.current !== null) {
      void stopEventStorm(true)
      return
    }

    void (async () => {
      const feedId = activeFeedId
      const feedMessages = await loadDemoFeedMessages(feedId)
      const token = eventStormTokenRef.current + 1
      eventStormTokenRef.current = token
      eventStormStateRef.current = createEventStormState(feedMessages)
      setEventStormRunning(true)
      scheduleEventStormTick(feedId, token)
      setLastEvent(
        getLoadedMessages().length === 0
          ? 'event storm started; waiting for loaded segment'
          : 'event storm started',
      )
    })()
  }, [
    activeFeedId,
    getLoadedMessages,
    scheduleEventStormTick,
    setLastEvent,
    stopEventStorm,
  ])

  const toggleBotPush = useCallback(() => {
    if (botPushTimerRef.current !== null) {
      stopBotPush()
      setLastEvent('bot push stopped')
      return
    }

    const feedId = activeFeedId
    const token = botPushTokenRef.current + 1
    botPushTokenRef.current = token
    setBotPushActive(true)
    scheduleBotPushTick(feedId, token)
    setLastEvent('bot push started')
  }, [activeFeedId, scheduleBotPushTick, setLastEvent, stopBotPush])

  return {
    eventStormRunning,
    botPushActive,
    stopLongRunningMocks,
    toggleEventStorm,
    toggleBotPush,
  }
}

function reportMockTickError(
  operation: Extract<DemoOperationName, 'mock.eventStorm' | 'mock.botPush'>,
  feedId: string,
  error: unknown,
  setLastEvent: (eventText: string) => void,
): void {
  const message = error instanceof Error ? error.message : String(error)
  setLastEvent(`${operation === 'mock.eventStorm' ? 'event storm' : 'bot push'} tick failed; retrying`)
  void writeDemoLog({
    requestId: createDemoRequestId(operation),
    operation,
    phase: 'error',
    feedId,
    error: message,
    details: { retrying: true },
  }).catch(() => {})
}
