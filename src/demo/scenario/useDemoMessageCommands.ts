import { useCallback } from 'react'
import type { MessageListSession } from '../../index'
import {
  createOutgoingMessage,
  type DemoMessage,
} from '../data/demoData'
import {
  appendDemoFeedMessages,
  flushDemoFeedPersistence,
  readDemoFeedMessages,
  replaceDemoFeedMessages,
  saveDemoViewportAnchor,
} from '../data/demoMessageApi'
import {
  createDemoRequestId,
  writeDemoLog,
} from '../data/demoLocalStoreClient'
import {
  highlightMessage,
  wait,
  waitMockDelay,
} from './demoScenarioHelpers'
import type {
  DemoHighlightState,
} from './demoScenarioTypes'

const SEND_FAILURE_RATE = 0.25
const RETRY_MOCK_DELAY_MS = 500

export type DemoMessageCommandActions = {
  sendMessage: (body: string) => boolean
  retryFailedSend: (messageId?: string) => boolean
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
  getHasMoreAfter: () => boolean
  getLoadedMessages: () => DemoMessage[]
  isActiveFeed: (feedId: string) => boolean
  pageSize: number
  sendDelayBaseMs: number
  setMessageCount: (messageCount: number) => void
  setLastEvent: (eventText: string) => void
  highlightState: DemoHighlightState
}): DemoMessageCommandActions {
  const {
    activeFeedId,
    getHasMoreAfter,
    getLoadedMessages,
    getSession,
    highlightState,
    isActiveFeed,
    pageSize,
    sendDelayBaseMs,
    session,
    setLastEvent,
    setMessageCount,
  } = input

  const stageOutgoingMessage = useCallback((
    feedId: string,
    message: DemoMessage,
    persistedMessages: DemoMessage[],
    shouldRebuildLatest: boolean,
    reason: 'send' | 'retry',
    options: {
      retireKeys?: string[]
    } = {},
  ) => {
    const targetSession = getSession(feedId)
    if (shouldRebuildLatest) {
      const latest = persistedMessages.slice(
        Math.max(0, persistedMessages.length - pageSize),
      )
      const latestMessage = latest.at(-1)
      targetSession.tail.local.stage({
        rows: [message],
        latest: {
          rows: latest,
          hasMoreBefore: persistedMessages.length > pageSize,
          hasMoreAfter: false,
          anchor: latestMessage
            ? {
                id: latestMessage.id,
                sessionId: feedId,
                stableId: latestMessage.id,
                serverId: latestMessage.id,
              }
            : undefined,
          anchorStatus: 'normal',
        },
        reason,
        retireKeys: options.retireKeys,
      })
      return
    }

    targetSession.tail.local.stage({
      rows: [message],
      reason,
      retireKeys: options.retireKeys,
    })
  }, [
    getSession,
    pageSize,
  ])

  const completeSendAttempt = useCallback((
    feedId: string,
    messageId: string,
    attempt: number,
  ) => {
    void (async () => {
      await waitMockDelay(sendDelayBaseMs)
      const failed = Math.random() < SEND_FAILURE_RATE
      const updated = updatePersistedMessage(feedId, messageId, (message) => {
        if (
          message.sendAttempt !== attempt ||
          message.sendStatus !== 'sending'
        ) {
          return undefined
        }

        return {
          ...message,
          sendStatus: failed ? 'failed' : 'sent',
          sendError: failed ? 'Simulated send failure' : undefined,
        }
      })

      if (!updated) {
        return
      }

      getSession(feedId).tail.local.patch([updated.message])
      await flushDemoFeedPersistence(feedId)
      if (isActiveFeed(feedId)) {
        setLastEvent(
          failed
            ? `send failed ${messageId}`
            : `sent ${messageId}`,
        )
      }
    })()
  }, [
    getSession,
    isActiveFeed,
    sendDelayBaseMs,
    setLastEvent,
  ])

  const completeRetryAttempt = useCallback((
    feedId: string,
    messageId: string,
    attempt: number,
  ) => {
    void (async () => {
      await wait(RETRY_MOCK_DELAY_MS)
      const failed = Math.random() < SEND_FAILURE_RATE

      if (failed) {
        const updated = updatePersistedMessage(feedId, messageId, (message) => {
          if (
            message.sendAttempt !== attempt ||
            message.sendStatus !== 'retrying'
          ) {
            return undefined
          }

          return {
            ...message,
            sendStatus: 'failed',
            sendError: 'Simulated retry failure',
          }
        })

        if (!updated) {
          return
        }

        getSession(feedId).tail.local.patch([updated.message])
        await flushDemoFeedPersistence(feedId)
        if (isActiveFeed(feedId)) {
          setLastEvent(`retry failed ${messageId}`)
        }
        return
      }

      const feedMessages = readDemoFeedMessages(feedId)
      const target = feedMessages.find((message) => message.id === messageId)

      if (
        !target ||
        target.sendAttempt !== attempt ||
        target.sendStatus !== 'retrying'
      ) {
        return
      }

      const shouldRebuildLatest = getHasMoreAfter()
      const retryMessage = createRetriedOutgoingMessage({
        feedId,
        target,
        sequence: (feedMessages.at(-1)?.sequence ?? 0) + 1,
      })
      const persistedMessages = replaceDemoFeedMessages(
        feedId,
        [
          ...feedMessages.filter((message) => message.id !== target.id),
          retryMessage,
        ],
      )

      saveDemoViewportAnchor(feedId, undefined)
      if (isActiveFeed(feedId)) {
        setMessageCount(persistedMessages.length)
      }
      publishRetriedOutgoingMessage({
        feedId,
        targetId: target.id,
        retryMessage,
        persistedMessages,
        shouldRebuildLatest,
        stageOutgoingMessage,
      })
      await flushDemoFeedPersistence(feedId)
      if (isActiveFeed(feedId)) {
        setLastEvent(`retried ${messageId} as ${retryMessage.id}`)
      }
    })()
  }, [
    getHasMoreAfter,
    getSession,
    isActiveFeed,
    setLastEvent,
    setMessageCount,
    stageOutgoingMessage,
  ])

  const sendMessage = useCallback((body: string): boolean => {
    const trimmed = body.trim()

    if (!trimmed) {
      return false
    }

    const allMessages = readDemoFeedMessages(activeFeedId)
    const shouldRebuildLatest = getHasMoreAfter()
    const message: DemoMessage = {
      ...createOutgoingMessage(trimmed, {
        feedId: activeFeedId,
        sequence: (allMessages.at(-1)?.sequence ?? 0) + 1,
        quoteCandidates: allMessages,
      }),
      sendStatus: 'sending',
      sendAttempt: 1,
      sendError: undefined,
    }
    const persistedMessages = appendDemoFeedMessages(activeFeedId, [message])

    saveDemoViewportAnchor(activeFeedId, undefined)
    if (isActiveFeed(activeFeedId)) {
      setMessageCount(persistedMessages.length)
    }

    stageOutgoingMessage(
      activeFeedId,
      message,
      persistedMessages,
      shouldRebuildLatest,
      'send',
    )
    if (isActiveFeed(activeFeedId)) {
      setLastEvent(
        shouldRebuildLatest
          ? `sending ${message.id} and rebuilt latest`
          : `sending ${message.id}`,
      )
    }

    completeSendAttempt(activeFeedId, message.id, message.sendAttempt ?? 1)
    return true
  }, [
    activeFeedId,
    completeSendAttempt,
    getHasMoreAfter,
    isActiveFeed,
    stageOutgoingMessage,
    setLastEvent,
    setMessageCount,
  ])

  const retryFailedSend = useCallback((messageId?: string): boolean => {
    const feedMessages = readDemoFeedMessages(activeFeedId)
    const target = messageId
      ? feedMessages.find((message) => message.id === messageId)
      : [...feedMessages].reverse().find((message) =>
          message.sendStatus === 'failed'
        )

    if (!target || target.sendStatus !== 'failed') {
      setLastEvent('no failed send to retry')
      return false
    }

    const retrying: DemoMessage = {
      ...target,
      sendStatus: 'retrying',
      sendAttempt: (target.sendAttempt ?? 1) + 1,
      sendError: undefined,
    }
    const updated = updatePersistedMessage(activeFeedId, target.id, () => retrying)

    if (!updated) {
      setLastEvent('no failed send to retry')
      return false
    }

    getSession(activeFeedId).tail.local.patch([updated.message])
    if (isActiveFeed(activeFeedId)) {
      setLastEvent(`retrying ${target.id}`)
    }
    completeRetryAttempt(activeFeedId, retrying.id, retrying.sendAttempt ?? 1)
    return true
  }, [
    activeFeedId,
    completeRetryAttempt,
    getSession,
    isActiveFeed,
    setLastEvent,
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
        sessionId: activeFeedId,
        stableId: target.messageId,
        serverId: target.messageId,
      }, {
        motion: {
          origin: input?.origin
            ? {
                sessionId: activeFeedId,
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

    const first = getLoadedMessages()[0]
    if (!first) {
      setLastEvent('no loaded quote target')
      return
    }

    session.commands.scrollToMessage({
      sessionId: activeFeedId,
      stableId: first.id,
      serverId: first.id,
    })
    highlightMessage(first.id, highlightState)
    setLastEvent('jump command sent to session')
  }, [activeFeedId, getLoadedMessages, highlightState, session, setLastEvent])

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
    retryFailedSend,
    followBottom: () => session.commands.scrollToLatest(),
    jumpToQuote,
    clearFeed,
  }
}

function updatePersistedMessage(
  feedId: string,
  messageId: string,
  mutate: (message: DemoMessage) => DemoMessage | undefined,
): { message: DemoMessage; messages: DemoMessage[] } | null {
  const feedMessages = readDemoFeedMessages(feedId)
  let nextMessage: DemoMessage | null = null
  const nextMessages = feedMessages.map((message) => {
    if (message.id !== messageId) {
      return message
    }

    const updated = mutate(message)

    if (!updated) {
      return message
    }

    nextMessage = updated
    return updated
  })

  if (!nextMessage) {
    return null
  }

  return {
    message: nextMessage,
    messages: replaceDemoFeedMessages(feedId, nextMessages),
  }
}

function createRetriedOutgoingMessage(input: {
  feedId: string
  target: DemoMessage
  sequence: number
}): DemoMessage {
  const { feedId, target, sequence } = input

  return {
    ...createOutgoingMessage(target.body, {
      feedId,
      sequence,
    }),
    kind: target.kind,
    expanded: target.expanded,
    media: target.media,
    quote: target.quote,
    sendStatus: 'sent',
    sendAttempt: target.sendAttempt,
    sendError: undefined,
  }
}

function publishRetriedOutgoingMessage(input: {
  feedId: string
  targetId: string
  retryMessage: DemoMessage
  persistedMessages: DemoMessage[]
  shouldRebuildLatest: boolean
  stageOutgoingMessage: (
    feedId: string,
    message: DemoMessage,
    persistedMessages: DemoMessage[],
    shouldRebuildLatest: boolean,
    reason: 'send' | 'retry',
    options?: {
      retireKeys?: string[]
    },
  ) => void
}): void {
  input.stageOutgoingMessage(
    input.feedId,
    input.retryMessage,
    input.persistedMessages,
    input.shouldRebuildLatest,
    'retry',
    {
      retireKeys: [input.targetId],
    },
  )
}
