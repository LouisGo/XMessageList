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
} from '../demoAdvancedMockScenarios'
import { readDemoFeedMessages } from '../demoMessageApi'
import { readLoadedMessages } from './demoScenarioHelpers'
import type {
  DemoDataRuntimeGetter,
} from './demoScenarioTypes'

export type DemoLongRunningMockActions = {
  eventStormRunning: boolean
  botPushActive: boolean
  stopLongRunningMocks: () => void
  toggleEventStorm: () => void
  toggleBotPush: () => void
}

export function useDemoLongRunningMocks(input: {
  activeFeedId: string
  getDataRuntime: DemoDataRuntimeGetter
  applyAdvancedMockResult: (
    feedId: string,
    result: AdvancedMockPublishResult,
    previousMessages: ReturnType<typeof readLoadedMessages>,
  ) => void
  setLastEvent: (eventText: string) => void
}): DemoLongRunningMockActions {
  const {
    activeFeedId,
    applyAdvancedMockResult,
    getDataRuntime,
    setLastEvent,
  } = input
  const [eventStormRunning, setEventStormRunning] = useState(false)
  const [botPushActive, setBotPushActive] = useState(false)
  const eventStormTimerRef = useRef<number | null>(null)
  const botPushTimerRef = useRef<number | null>(null)
  const eventStormStateRef = useRef<AdvancedMockEventStormState | null>(null)
  const eventStormTokenRef = useRef(0)
  const botPushTokenRef = useRef(0)

  const stopEventStorm = useCallback((flushBuffered: boolean) => {
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

    const dataRuntime = getDataRuntime(activeFeedId)
    const previousMessages = readLoadedMessages(dataRuntime)
    const result = flushEventStormBuffer({
      feedId: activeFeedId,
      feedMessages: readDemoFeedMessages(activeFeedId),
      messages: previousMessages,
      hasMoreAfter: dataRuntime.getSegment().hasMoreAfter,
      state: eventStormStateRef.current,
    })
    eventStormStateRef.current = null

    if (result) {
      applyAdvancedMockResult(activeFeedId, result, previousMessages)
      return
    }

    setLastEvent('event storm stopped')
  }, [activeFeedId, applyAdvancedMockResult, getDataRuntime, setLastEvent])

  const stopBotPush = useCallback(() => {
    if (botPushTimerRef.current !== null) {
      window.clearTimeout(botPushTimerRef.current)
      botPushTimerRef.current = null
    }
    botPushTokenRef.current += 1
    setBotPushActive(false)
  }, [])

  const stopLongRunningMocks = useCallback(() => {
    stopEventStorm(false)
    stopBotPush()
  }, [stopBotPush, stopEventStorm])

  const scheduleEventStormTick = useCallback(function schedule(
    feedId: string,
    token: number,
  ) {
    eventStormTimerRef.current = window.setTimeout(() => {
      if (eventStormTokenRef.current !== token || !eventStormStateRef.current) {
        return
      }

      const dataRuntime = getDataRuntime(feedId)
      const previousMessages = readLoadedMessages(dataRuntime)
      const result = applyEventStormTick({
        feedId,
        feedMessages: readDemoFeedMessages(feedId),
        messages: previousMessages,
        hasMoreAfter: dataRuntime.getSegment().hasMoreAfter,
        state: eventStormStateRef.current,
      })

      if (result) {
        applyAdvancedMockResult(feedId, result, previousMessages)
      }

      schedule(feedId, token)
    }, getNextEventStormDelayMs())
  }, [applyAdvancedMockResult, getDataRuntime])

  const scheduleBotPushTick = useCallback(function schedule(
    feedId: string,
    token: number,
  ) {
    botPushTimerRef.current = window.setTimeout(() => {
      if (botPushTokenRef.current !== token) {
        return
      }

      const dataRuntime = getDataRuntime(feedId)
      const previousMessages = readLoadedMessages(dataRuntime)
      const result = applyBotPushTick({
        feedId,
        feedMessages: readDemoFeedMessages(feedId),
        messages: previousMessages,
        hasMoreAfter: dataRuntime.getSegment().hasMoreAfter,
      })

      applyAdvancedMockResult(feedId, result, previousMessages)
      schedule(feedId, token)
    }, getNextBotPushDelayMs())
  }, [applyAdvancedMockResult, getDataRuntime])

  const toggleEventStorm = useCallback(() => {
    if (eventStormTimerRef.current !== null) {
      stopEventStorm(true)
      return
    }

    const feedId = activeFeedId
    const dataRuntime = getDataRuntime(feedId)
    const token = eventStormTokenRef.current + 1
    eventStormTokenRef.current = token
    eventStormStateRef.current = createEventStormState(readDemoFeedMessages(feedId))
    setEventStormRunning(true)
    scheduleEventStormTick(feedId, token)
    setLastEvent(
      dataRuntime.getSegment().items.length === 0
        ? 'event storm started; waiting for loaded segment'
        : 'event storm started',
    )
  }, [activeFeedId, getDataRuntime, scheduleEventStormTick, setLastEvent, stopEventStorm])

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
