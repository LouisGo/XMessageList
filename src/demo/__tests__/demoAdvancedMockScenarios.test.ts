import { describe, expect, it } from 'vitest'

import {
  applyBotPushTick,
  applyEventStormTick,
  createEventStormState,
  flushEventStormBuffer,
} from '../mocks/demoAdvancedMockScenarios'
import {
  createDemoMessageId,
  createDemoMessages,
  createNewestMessage,
  createOutgoingMessage,
  type DemoMessage,
} from '../data/demoData'

describe('demoAdvancedMockScenarios', () => {
  it('deletes a single message from the last loaded hot window', () => {
    const { result, deletedMessages } = runDeleteScenario([0.1, 0.2])

    expect(result.details.delete).toBe(1)
    expect(result.effect).toBe('anchor-risk')
    expect(result.details.deleteModes).toEqual(
      expect.objectContaining({ single: 1 }),
    )
    expect(deletedMessages).toHaveLength(1)
    expect(Math.min(...deletedMessages.map((message) => message.sequence)))
      .toBeGreaterThan(40)
  })

  it('deletes a contiguous message block from the hot window', () => {
    const { result, deletedMessages } = runDeleteScenario([0.65, 0.99, 0])
    const deletedSequences = deletedMessages.map((message) => message.sequence)

    expect(result.details.delete).toBe(6)
    expect(result.effect).toBe('anchor-risk')
    expect(result.details.deleteModes).toEqual(
      expect.objectContaining({ contiguous: 1 }),
    )
    expect(deletedMessages).toHaveLength(6)
    expect(deletedSequences).toEqual([...deletedSequences].sort((a, b) => a - b))
  })

  it('keeps delayed storm appends from overwriting messages sent locally', () => {
    const feedId = 'feed-runtime'
    const baseMessages = createDemoMessages(3, feedId)
    const state = createEventStormState(baseMessages)
    const sequence = 4
    const oldId = createDemoMessageId(feedId, sequence)
    const remappedId = createDemoMessageId(feedId, sequence + 1)
    const bufferedStormMessage = {
      ...createNewestMessage({ feedId, sequence }),
      body: `${oldId} buffered storm message`,
    }
    const sentMessage = createOutgoingMessage('local send', {
      feedId,
      sequence,
      quoteCandidates: baseMessages,
      random: () => 0.9,
    })
    const currentMessages = [...baseMessages, sentMessage]

    state.deliveryBuffer = [bufferedStormMessage]
    state.nextSequence = sequence + 1

    const result = applyEventStormTick({
      feedId,
      feedMessages: currentMessages,
      messages: currentMessages,
      hasMoreAfter: false,
      state,
      random: createRandomSource([
        0.1,
        0.1,
        0.2,
        0.9,
        0,
        0,
        0.9,
        0.9,
        0.2,
        0.9,
        0,
        0.9,
      ]),
    })

    if (!result) {
      throw new Error('expected storm append to publish a result')
    }

    expect(result.messages.find((message) => message.id === sentMessage.id)?.body)
      .toBe('local send')
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: remappedId,
          body: `${remappedId} buffered storm message`,
        }),
      ]),
    )
    expect(result.details.visibleOutOfOrderAppendCount).toBe(0)
    expect(result.details.visibleTailAppendCount).toBe(1)
  })

  it('flushes buffered storm messages and keeps bot push as host-only data', () => {
    const feedId = 'feed-runtime'
    const messages = createDemoMessages(5, feedId)
    const state = createEventStormState(messages)

    state.deliveryBuffer = [
      createNewestMessage({ feedId, sequence: 6 }),
      createNewestMessage({ feedId, sequence: 7 }),
    ]

    const flushed = flushEventStormBuffer({
      feedId,
      feedMessages: messages,
      messages,
      hasMoreAfter: false,
      state,
    })
    const pushed = applyBotPushTick({
      feedId,
      feedMessages: flushed?.feedMessages ?? messages,
      messages: flushed?.messages ?? messages,
      hasMoreAfter: false,
      random: createRandomSource([0, 0, 0.9, 0, 0, 0.9, 0.9]),
    })

    expect(flushed?.messages).toHaveLength(7)
    expect(flushed?.effect).toBe('append')
    expect(pushed.messages.length).toBeGreaterThan(7)
    expect(pushed.details.source).toBe('bot-push')
  })
})

function runDeleteScenario(deleteRandomValues: number[]): {
  result: NonNullable<ReturnType<typeof applyEventStormTick>>
  deletedMessages: DemoMessage[]
} {
  const feedId = 'feed-runtime'
  const messages = createDemoMessages(140, feedId)
  const state = createEventStormState(messages)
  const result = applyEventStormTick({
    feedId,
    feedMessages: messages,
    messages,
    hasMoreAfter: false,
    state,
    random: createRandomSource([
      0.1,
      0.99,
      ...deleteRandomValues,
    ]),
  })

  if (!result) {
    throw new Error('expected delete scenario to publish a result')
  }

  const remainingIds = new Set(result.messages.map((message) => message.id))
  const deletedMessages = messages.filter((message) => !remainingIds.has(message.id))

  return { result, deletedMessages }
}

function createRandomSource(values: number[]): () => number {
  let index = 0

  return () => {
    const value = values[index] ?? values.at(-1)
    index += 1
    return value ?? 0
  }
}
