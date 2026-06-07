import { useCallback, useRef } from 'react'
import type { MessageListSession } from '../../index'
import {
  createNewestMessage,
  type DemoMessage,
} from '../data/demoData'
import {
  appendDemoFeedMessages,
  flushDemoFeedPersistence,
  readDemoFeedMessages,
} from '../data/demoMessageApi'
import {
  createMockNewestMessages,
  wait,
} from './demoScenarioHelpers'
import { createDemoLatestPage } from './demoMessageCommandHelpers'
import type {
  PendingOptimisticRemap,
} from './demoScenarioTypes'

export type DemoOptimisticRemapActions = {
  resetOptimisticRemap: () => void
  sendOptimisticMessage: () => void
  alignPendingOptimisticAtStart: () => void
  resolveOptimisticRemap: () => void
  sendOptimisticAndRemap: () => Promise<void>
}

export function useDemoOptimisticRemap(input: {
  activeFeedId: string
  session: MessageListSession<DemoMessage>
  isActiveFeed: (feedId: string) => boolean
  pageSize: number
  setLastEvent: (eventText: string) => void
  onMessageCountChange: (messageCount: number) => void
}): DemoOptimisticRemapActions {
  const {
    activeFeedId,
    isActiveFeed,
    pageSize,
    session,
    setLastEvent,
    onMessageCountChange,
  } = input
  const pendingOptimisticRemapRef = useRef<PendingOptimisticRemap | null>(null)

  const resetOptimisticRemap = useCallback(() => {
    pendingOptimisticRemapRef.current = null
  }, [])

  const sendOptimisticMessage = useCallback(() => {
    const allMessages = readDemoFeedMessages(activeFeedId)
    const nextSequence = (allMessages.at(-1)?.sequence ?? 0) + 1
    const localId = `local-${Date.now()}`
    const committedMessage = createNewestMessage(
      activeFeedId,
      nextSequence,
      'Optimistic send committed by server',
    )
    const tailMessages = createMockNewestMessages({
      feedId: activeFeedId,
      count: 6,
      existingMessages: [...allMessages, committedMessage],
      startSequence: nextSequence + 1,
    })
    const serverId = committedMessage.id
    const optimistic: DemoMessage = {
      ...committedMessage,
      id: localId,
      body: 'Optimistic send awaiting server id',
    }

    const persistedMessages = appendDemoFeedMessages(activeFeedId, [
      committedMessage,
      ...tailMessages,
    ])
    if (isActiveFeed(activeFeedId)) {
      onMessageCountChange(persistedMessages.length)
    }
    pendingOptimisticRemapRef.current = {
      feedId: activeFeedId,
      localId,
      serverId,
      remap: {
        from: {
          sessionId: activeFeedId,
          stableId: localId,
          localId,
        },
        to: {
          sessionId: activeFeedId,
          stableId: serverId,
          serverId,
        },
        previousKey: localId,
        nextKey: serverId,
      },
    }
    session.tail.local.stage({
      rows: [optimistic, ...tailMessages],
      latest: session.getState().loaded.context !== 'latest'
        ? createDemoLatestPage({
            feedId: activeFeedId,
            messages: persistedMessages.slice(0, -tailMessages.length),
            pageSize,
          })
        : undefined,
      reason: 'send',
    })
    void flushDemoFeedPersistence(activeFeedId)
    if (isActiveFeed(activeFeedId)) {
      setLastEvent('optimistic local identity published')
    }
  }, [activeFeedId, isActiveFeed, onMessageCountChange, pageSize, session, setLastEvent])

  const alignPendingOptimisticAtStart = useCallback(() => {
    const pending = pendingOptimisticRemapRef.current

    if (!pending || pending.feedId !== activeFeedId) {
      setLastEvent('no optimistic message to align')
      return
    }

    session.commands.scrollToMessage({
      sessionId: pending.feedId,
      stableId: pending.localId,
      localId: pending.localId,
    }, { align: 'start' })
    setLastEvent('aligned optimistic row at viewport start')
  }, [activeFeedId, session, setLastEvent])

  const resolveOptimisticRemap = useCallback(() => {
    const pending = pendingOptimisticRemapRef.current

    if (!pending || pending.feedId !== activeFeedId) {
      setLastEvent('no optimistic remap pending')
      return
    }

    session.tail.local.applyIdentityRemap([pending.remap])
    pendingOptimisticRemapRef.current = null
    if (isActiveFeed(activeFeedId)) {
      setLastEvent('optimistic identity remapped to server id')
    }
  }, [activeFeedId, isActiveFeed, session, setLastEvent])

  const sendOptimisticAndRemap = useCallback(async () => {
    sendOptimisticMessage()
    await wait(0)
    resolveOptimisticRemap()
  }, [resolveOptimisticRemap, sendOptimisticMessage])

  return {
    resetOptimisticRemap,
    sendOptimisticMessage,
    alignPendingOptimisticAtStart,
    resolveOptimisticRemap,
    sendOptimisticAndRemap,
  }
}
