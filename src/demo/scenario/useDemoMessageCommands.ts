import { useCallback } from 'react'
import type { MessageListSession } from '../../index'
import {
  createOutgoingMessage,
  type DemoMessage,
} from '../data/demoData'
import {
  appendDemoFeedMessages,
  flushDemoFeedPersistence,
  loadDemoFeedMessages,
  replaceDemoFeedMessages,
  saveDemoViewportAnchor,
} from '../data/demoMessageApi'
import {
  createDemoRequestId,
  writeDemoLog,
} from '../data/demoLocalStoreClient'
import {
  highlightMessage,
  readLoadedMessages,
  waitMockDelay,
} from './demoScenarioHelpers'
import type {
  DemoDataRuntimeGetter,
  DemoHighlightState,
} from './demoScenarioTypes'

export type DemoMessageCommandActions = {
  sendMessage: (body: string) => boolean
  followBottom: () => void
  jumpToQuote: (input?: {
    origin: { messageId: string; position?: number }
    target: { messageId: string; position?: number }
  }) => void
  clearFeed: (feedId: string) => void
}

export function useDemoMessageCommands(input: {
  activeFeedId: string
  session: MessageListSession<DemoMessage>
  getSession: (feedId: string) => MessageListSession<DemoMessage>
  getDataRuntime: DemoDataRuntimeGetter
  isActiveFeed: (feedId: string) => boolean
  pageSize: number
  sendDelayBaseMs: number
  setMessageCount: (messageCount: number) => void
  setLastEvent: (eventText: string) => void
  highlightState: DemoHighlightState
}): DemoMessageCommandActions {
  const {
    activeFeedId,
    getDataRuntime,
    getSession,
    highlightState,
    isActiveFeed,
    pageSize,
    sendDelayBaseMs,
    session,
    setLastEvent,
    setMessageCount,
  } = input

  const sendMessage = useCallback((body: string): boolean => {
    const trimmed = body.trim()

    if (!trimmed) {
      return false
    }

    void (async () => {
      await waitMockDelay(sendDelayBaseMs)

      const allMessages = await loadDemoFeedMessages(activeFeedId)
      const dataRuntime = getDataRuntime(activeFeedId)
      const shouldRebuildLatest = dataRuntime.getSegment().hasMoreAfter
      const message = createOutgoingMessage(trimmed, {
        feedId: activeFeedId,
        sequence: (allMessages.at(-1)?.sequence ?? 0) + 1,
        quoteCandidates: allMessages,
      })
      const persistedMessages = appendDemoFeedMessages(activeFeedId, [message])

      saveDemoViewportAnchor(activeFeedId, undefined)
      await flushDemoFeedPersistence(activeFeedId)
      if (isActiveFeed(activeFeedId)) {
        setMessageCount(persistedMessages.length)
      }

      if (shouldRebuildLatest) {
        session.commands.scrollToLatest()
        // 当前窗口不在 latest tail 时，send 先打开 follow-bottom intent，再用 reset-latest 重建尾部窗口。
        const latest = persistedMessages.slice(
          Math.max(0, persistedMessages.length - pageSize),
        )
        const latestMessage = latest.at(-1)
        session.rows.resetLatest({
          rows: latest,
          hasMoreBefore: persistedMessages.length > pageSize,
          hasMoreAfter: false,
          anchor: latestMessage
            ? {
                id: latestMessage.id,
                feedId: activeFeedId,
                stableId: latestMessage.id,
                serverId: latestMessage.id,
              }
            : undefined,
          anchorStatus: 'normal',
        })
        if (isActiveFeed(activeFeedId)) {
          setLastEvent(`sent ${message.id} and rebuilt latest`)
        }
        return
      }

      session.commands.scrollToLatest()
      session.rows.patch([message])
      if (isActiveFeed(activeFeedId)) {
        setLastEvent(`sent ${message.id}`)
      }
    })()
    return true
  }, [
    activeFeedId,
    getDataRuntime,
    isActiveFeed,
    pageSize,
    session,
    sendDelayBaseMs,
    setLastEvent,
    setMessageCount,
  ])

  const jumpToQuote = useCallback((input?: {
    origin: { messageId: string; position?: number }
    target: { messageId: string; position?: number }
  }) => {
    const target = input?.target

    if (target) {
      void writeDemoLog({
        requestId: createDemoRequestId('session.command.quoteJump'),
        operation: 'session.command.quoteJump',
        phase: 'info',
        feedId: activeFeedId,
        details: {
          origin: input?.origin,
          target,
        },
      })
      session.commands.scrollToMessage({
        feedId: activeFeedId,
        stableId: target.messageId,
        serverId: target.messageId,
      }, {
        motion: {
          origin: input?.origin
            ? {
                feedId: activeFeedId,
                stableId: input.origin.messageId,
                serverId: input.origin.messageId,
              }
            : undefined,
          direction: input?.origin?.position !== undefined &&
            target.position !== undefined
              ? target.position < input.origin.position ? 'before' : 'after'
              : undefined,
        },
      })
      highlightMessage(target.messageId, highlightState)
      setLastEvent(`jump to quote ${target.messageId}`)
      return
    }

    const first = readLoadedMessages(getDataRuntime(activeFeedId))[0]
    if (!first) {
      setLastEvent('no loaded quote target')
      return
    }

    session.commands.scrollToMessage({
      feedId: activeFeedId,
      stableId: first.id,
      serverId: first.id,
    })
    highlightMessage(first.id, highlightState)
    setLastEvent('jump command sent to session')
  }, [activeFeedId, getDataRuntime, highlightState, session, setLastEvent])

  const clearFeed = useCallback((feedId: string) => {
    replaceDemoFeedMessages(feedId, [])
    if (isActiveFeed(feedId)) {
      setMessageCount(0)
      getSession(feedId).rows.clear()
    }
    void flushDemoFeedPersistence(feedId)
    if (isActiveFeed(feedId)) {
      setLastEvent(`cleared ${feedId}`)
    }
  }, [
    getSession,
    isActiveFeed,
    setLastEvent,
    setMessageCount,
  ])

  return {
    sendMessage,
    followBottom: () => session.commands.scrollToLatest(),
    jumpToQuote,
    clearFeed,
  }
}
