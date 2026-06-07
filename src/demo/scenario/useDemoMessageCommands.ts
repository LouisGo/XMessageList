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
} from '../data/demoMessageApi'
import {
  createDemoRequestId,
  type DemoLogPhase,
  type DemoOperationName,
  writeDemoLog,
} from '../data/demoLocalStoreClient'
import {
  highlightMessage,
  wait,
  waitMockDelay,
} from './demoScenarioHelpers'
import {
  createDemoLatestPage,
  createRetriedOutgoingMessage,
  publishRetriedOutgoingMessage,
  updatePersistedMessage,
} from './demoMessageCommandHelpers'
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
  hasSession: (feedId: string) => boolean
  getHasMoreAfter: () => boolean
  getLoadedMessages: () => DemoMessage[]
  invalidateAnchorMemory: (feedId: string) => void
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
    hasSession,
    highlightState,
    invalidateAnchorMemory,
    isActiveFeed,
    pageSize,
    sendDelayBaseMs,
    session,
    setLastEvent,
    setMessageCount,
  } = input

  const logCommand = useCallback((
    operation: DemoOperationName,
    phase: DemoLogPhase,
    details: Record<string, unknown>,
    feedId = activeFeedId,
    messageCount?: number,
  ) => {
    void writeDemoLog({
      requestId: createDemoRequestId(operation),
      operation,
      phase,
      feedId,
      messageCount,
      details,
    })
  }, [activeFeedId])

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
    if (shouldRebuildLatest || targetSession.getState().loaded.context !== 'latest') {
      const baselineMessages = persistedMessages.filter((candidate) =>
        candidate.id !== message.id
      )
      targetSession.tail.local.stage({
        rows: [message],
        latest: createDemoLatestPage({ feedId, messages: baselineMessages, pageSize }),
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

      logCommand(
        'message.send',
        failed ? 'error' : 'success',
        {
          reason: 'send',
          messageId,
          attempt,
          status: updated.message.sendStatus,
          sendError: updated.message.sendError,
        },
        feedId,
        1,
      )
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
    logCommand,
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

        logCommand(
          'message.send',
          'error',
          {
            reason: 'retry',
            messageId,
            attempt,
            status: updated.message.sendStatus,
            sendError: updated.message.sendError,
          },
          feedId,
          1,
        )
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

      invalidateAnchorMemory(feedId)
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
      logCommand(
        'message.send',
        'success',
        {
          reason: 'retry',
          retiredMessageId: target.id,
          messageId: retryMessage.id,
          attempt: target.sendAttempt,
          status: retryMessage.sendStatus,
          shouldRebuildLatest,
        },
        feedId,
        1,
      )
      await flushDemoFeedPersistence(feedId)
      if (isActiveFeed(feedId)) {
        setLastEvent(`retried ${messageId} as ${retryMessage.id}`)
      }
    })()
  }, [
    getHasMoreAfter,
    getSession,
    invalidateAnchorMemory,
    isActiveFeed,
    logCommand,
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

    invalidateAnchorMemory(activeFeedId)
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
    logCommand(
      'message.send',
      'start',
      {
        reason: 'send',
        messageId: message.id,
        shouldRebuildLatest,
        messageCountBefore: allMessages.length,
        messageCountAfter: persistedMessages.length,
      },
      activeFeedId,
      1,
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
    invalidateAnchorMemory,
    isActiveFeed,
    logCommand,
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
    logCommand(
      'message.send',
      'start',
      {
        reason: 'retry',
        messageId: target.id,
        attempt: retrying.sendAttempt,
      },
      activeFeedId,
      1,
    )
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
    logCommand,
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
      logCommand(
        'session.command.quoteJump',
        'skip',
        { reason: 'no-loaded-target' },
      )
      setLastEvent('no loaded quote target')
      return
    }

    logCommand(
      'session.command.quoteJump',
      'info',
      {
        origin: null,
        target: {
          messageId: first.id,
          position: first.sequence,
        },
      },
    )
    session.commands.scrollToMessage({
      sessionId: activeFeedId,
      stableId: first.id,
      serverId: first.id,
    })
    highlightMessage(first.id, highlightState)
    setLastEvent('jump command sent to session')
  }, [
    activeFeedId,
    getLoadedMessages,
    highlightState,
    logCommand,
    session,
    setLastEvent,
  ])

  const clearFeed = useCallback((feedId: string) => {
    logCommand(
      'feed.clear',
      'start',
      {
        targetFeedId: feedId,
        hadSession: hasSession(feedId),
        wasActiveFeed: isActiveFeed(feedId),
      },
      feedId,
    )
    replaceDemoFeedMessages(feedId, [])
    invalidateAnchorMemory(feedId)
    if (hasSession(feedId)) {
      getSession(feedId).rows.clear()
    }
    if (isActiveFeed(feedId)) {
      setMessageCount(0)
    }
    void flushDemoFeedPersistence(feedId)
    if (isActiveFeed(feedId)) {
      setLastEvent(`cleared ${feedId}`)
    }
    logCommand(
      'feed.clear',
      'success',
      { targetFeedId: feedId },
      feedId,
    )
  }, [
    getSession,
    hasSession,
    invalidateAnchorMemory,
    isActiveFeed,
    logCommand,
    setLastEvent,
    setMessageCount,
  ])

  const followBottom = useCallback(() => {
    logCommand(
      'session.command.followBottom',
      'info',
      {
        loadedMessageCount: getLoadedMessages().length,
        hasMoreAfter: getHasMoreAfter(),
      },
    )
    session.commands.scrollToLatest()
  }, [
    getHasMoreAfter,
    getLoadedMessages,
    logCommand,
    session,
  ])

  return {
    sendMessage,
    retryFailedSend,
    followBottom,
    jumpToQuote,
    clearFeed,
  }
}
