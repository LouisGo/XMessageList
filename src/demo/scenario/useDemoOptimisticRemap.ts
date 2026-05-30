import { useCallback, useRef } from 'react'
import type { MessageListRuntime } from '../../runtime'
import {
  createNewestMessage,
  toDemoMessageDataItem,
  type DemoMessage,
} from '../demoData'
import {
  appendDemoFeedMessages,
  flushDemoFeedPersistence,
  readDemoFeedMessages,
} from '../demoMessageApi'
import {
  createMockNewestMessages,
  wait,
} from './demoScenarioHelpers'
import type {
  DemoDataRuntimeGetter,
  DemoSegmentPublisher,
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
  runtime: MessageListRuntime<DemoMessage>
  getDataRuntime: DemoDataRuntimeGetter
  isActiveFeed: (feedId: string) => boolean
  publishSegment: DemoSegmentPublisher
  setLastEvent: (eventText: string) => void
  onMessageCountChange: (messageCount: number) => void
}): DemoOptimisticRemapActions {
  const {
    activeFeedId,
    getDataRuntime,
    isActiveFeed,
    publishSegment,
    runtime,
    setLastEvent,
    onMessageCountChange,
  } = input
  const pendingOptimisticRemapRef = useRef<PendingOptimisticRemap | null>(null)

  const resetOptimisticRemap = useCallback(() => {
    pendingOptimisticRemapRef.current = null
  }, [])

  const sendOptimisticMessage = useCallback(() => {
    const dataRuntime = getDataRuntime(activeFeedId)
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
          feedId: activeFeedId,
          stableId: localId,
          localId,
        },
        to: {
          feedId: activeFeedId,
          stableId: serverId,
          serverId,
        },
        previousKey: localId,
        nextKey: serverId,
      },
    }
    dataRuntime.patchItems([
      {
        ...toDemoMessageDataItem(optimistic),
        rowKind: 'message',
        identity: {
          feedId: activeFeedId,
          stableId: localId,
          localId,
          version: 1,
        },
      },
      ...tailMessages.map(toDemoMessageDataItem),
    ])
    publishSegment(dataRuntime)
    void flushDemoFeedPersistence(activeFeedId)
    if (isActiveFeed(activeFeedId)) {
      setLastEvent('optimistic local identity published')
    }
  }, [activeFeedId, getDataRuntime, isActiveFeed, onMessageCountChange, publishSegment, setLastEvent])

  const alignPendingOptimisticAtStart = useCallback(() => {
    const pending = pendingOptimisticRemapRef.current

    if (!pending || pending.feedId !== activeFeedId) {
      setLastEvent('no optimistic message to align')
      return
    }

    runtime.scrollToMessage({
      feedId: pending.feedId,
      stableId: pending.localId,
      localId: pending.localId,
    }, { align: 'start' })
    setLastEvent('aligned optimistic row at viewport start')
  }, [activeFeedId, runtime, setLastEvent])

  const resolveOptimisticRemap = useCallback(() => {
    const pending = pendingOptimisticRemapRef.current

    if (!pending || pending.feedId !== activeFeedId) {
      setLastEvent('no optimistic remap pending')
      return
    }

    const dataRuntime = getDataRuntime(activeFeedId)
    dataRuntime.applyIdentityRemap([pending.remap])
    publishSegment(dataRuntime)
    pendingOptimisticRemapRef.current = null
    if (isActiveFeed(activeFeedId)) {
      setLastEvent('optimistic identity remapped to server id')
    }
  }, [activeFeedId, getDataRuntime, isActiveFeed, publishSegment, setLastEvent])

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
