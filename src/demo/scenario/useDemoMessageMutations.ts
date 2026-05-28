import { useCallback, useRef } from 'react'
import type { MessageListRuntime } from '../../runtime'
import type { DemoMessage } from '../demoData'
import { readDemoFeedMessages } from '../demoMessageApi'
import {
  readLoadedMessages,
} from './demoScenarioHelpers'
import type {
  DemoDataRuntimeGetter,
  DemoLoadedMessagesReplacer,
} from './demoScenarioTypes'

const REACTION_EMOJIS = ['😀', '😂', '🔥', '👍', '🎉', '😭', '👀', '❤️', '🚀', '🥲']

export type DemoMessageMutationActions = {
  resetMessageMutationState: () => void
  editMessage: (messageId: string, nextBody: string) => void
  deleteMessage: (messageId: string) => void
  reactToMessage: (messageId: string) => void
  toggleDynamicHeight: () => void
  streamCurrentRow: () => void
}

export function useDemoMessageMutations(input: {
  activeFeedId: string
  runtime: MessageListRuntime<DemoMessage>
  getDataRuntime: DemoDataRuntimeGetter
  replaceLoadedMessages: DemoLoadedMessagesReplacer
  setLastEvent: (eventText: string) => void
}): DemoMessageMutationActions {
  const {
    activeFeedId,
    getDataRuntime,
    replaceLoadedMessages,
    runtime,
    setLastEvent,
  } = input
  const dynamicHeightExpandedRef = useRef(false)

  const resetMessageMutationState = useCallback(() => {
    dynamicHeightExpandedRef.current = false
  }, [])

  const updateMessage = useCallback((
    messageId: string,
    mutate: (message: DemoMessage) => DemoMessage | null,
    eventText: string,
  ) => {
    const dataRuntime = getDataRuntime(activeFeedId)
    const currentMessages = readLoadedMessages(dataRuntime)
    const feedMessages = readDemoFeedMessages(activeFeedId)
    let changed = false
    const nextFeedMessages = feedMessages.flatMap((message) => {
      if (message.id !== messageId) {
        return [message]
      }

      changed = true
      const nextMessage = mutate(message)
      return nextMessage ? [nextMessage] : []
    })

    if (!changed) {
      setLastEvent(`message ${messageId} not found`)
      return
    }

    const nextMessages = currentMessages.flatMap((message) => {
      if (message.id !== messageId) {
        return [message]
      }

      const nextMessage = mutate(message)
      return nextMessage ? [nextMessage] : []
    })

    void replaceLoadedMessages({
      feedId: activeFeedId,
      feedMessages: nextFeedMessages,
      messages: nextMessages,
      changedKeys: [messageId],
      eventText,
    })
  }, [activeFeedId, getDataRuntime, replaceLoadedMessages, setLastEvent])

  const toggleDynamicHeight = useCallback(() => {
    const dataRuntime = getDataRuntime(activeFeedId)
    const currentMessages = readLoadedMessages(dataRuntime)

    if (currentMessages.length === 0) {
      return
    }

    dynamicHeightExpandedRef.current = !dynamicHeightExpandedRef.current
    const target = currentMessages[Math.floor(currentMessages.length / 2)]

    if (!target) {
      return
    }

    updateMessage(
      target.id,
      (message) => ({
        ...message,
        expanded: dynamicHeightExpandedRef.current,
      }),
      dynamicHeightExpandedRef.current
        ? 'expanded dynamic row height'
        : 'collapsed dynamic row height',
    )
  }, [activeFeedId, getDataRuntime, updateMessage])

  const streamCurrentRow = useCallback(() => {
    const visibleKey = runtime.getEvidence().visibleRows[0]?.key
    const current = getDataRuntime(activeFeedId).getSegment()
    const target = current.items.find((item) => item.key === visibleKey) ??
      current.items[Math.floor(current.items.length / 2)]
    const message = target?.message

    if (!message) {
      setLastEvent('no visible row to stream')
      return
    }

    const streamed = {
      ...message,
      body: `${message.body}\n\nStreaming update ${Date.now()}`,
      editedAt: new Date().toISOString(),
    }
    updateMessage(streamed.id, () => streamed, 'streamed current row')
  }, [activeFeedId, getDataRuntime, runtime, setLastEvent, updateMessage])

  const editMessage = useCallback((messageId: string, nextBody: string) => {
    const trimmed = nextBody.trim()

    if (!trimmed) {
      setLastEvent('edit skipped: empty body')
      return
    }

    updateMessage(
      messageId,
      (message) => ({
        ...message,
        body: trimmed,
        kind: trimmed.length > 180 ? 'longText' : message.kind,
        editedAt: new Date().toISOString(),
      }),
      `edited ${messageId}`,
    )
  }, [setLastEvent, updateMessage])

  const deleteMessage = useCallback((messageId: string) => {
    updateMessage(messageId, () => null, `deleted ${messageId}`)
  }, [updateMessage])

  const reactToMessage = useCallback((messageId: string) => {
    updateMessage(
      messageId,
      (message) => ({
        ...message,
        reactions: [
          ...message.reactions,
          REACTION_EMOJIS[
            (message.reactions.length + message.sequence) % REACTION_EMOJIS.length
          ] ?? '👍',
        ],
      }),
      `reacted to ${messageId}`,
    )
  }, [updateMessage])

  return {
    resetMessageMutationState,
    editMessage,
    deleteMessage,
    reactToMessage,
    toggleDynamicHeight,
    streamCurrentRow,
  }
}
