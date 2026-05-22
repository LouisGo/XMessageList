import { describe, expect, it } from 'vitest'

import {
  applyEventStormTick,
  createEventStormState,
} from '../demoAdvancedMockScenarios'
import {
  createDemoMessages,
  createNewestMessage,
  createOutgoingMessage,
  type DemoMessage,
} from '../demoData'

describe('demoAdvancedMockScenarios', () => {
  it('deletes a single message from the last 100 loaded messages', () => {
    const { result, deletedMessages } = runDeleteScenario([0.1, 0.2])

    expect(result.details.delete).toBe(1)
    expect(result.details.deleteModes).toEqual(
      expect.objectContaining({ single: 1 }),
    )
    expect(deletedMessages).toHaveLength(1)
    expect(Math.min(...deletedMessages.map((message) => message.sequence))).toBeGreaterThan(40)
  })

  it('deletes a contiguous block of 3 to 6 messages from the last 100', () => {
    const { result, deletedMessages } = runDeleteScenario([0.65, 0.99, 0])
    const deletedSequences = deletedMessages.map((message) => message.sequence)

    expect(result.details.delete).toBe(6)
    expect(result.details.deleteModes).toEqual(
      expect.objectContaining({ contiguous: 1 }),
    )
    expect(deletedMessages).toHaveLength(6)
    expect(Math.min(...deletedSequences)).toBeGreaterThan(40)
    expect(deletedSequences).toEqual([...deletedSequences].sort((a, b) => a - b))
  })

  it('deletes a sparse non-contiguous set of 2 to 10 messages from the last 100', () => {
    const { result, deletedMessages } = runDeleteScenario([
      0.9,
      0.99,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
      0.5,
    ])
    const deletedSequences = deletedMessages
      .map((message) => message.sequence)
      .sort((left, right) => left - right)

    expect(result.details.delete).toBe(10)
    expect(result.details.deleteModes).toEqual(
      expect.objectContaining({ jump: 1 }),
    )
    expect(deletedMessages).toHaveLength(10)
    expect(Math.min(...deletedSequences)).toBeGreaterThan(40)
    expect(
      deletedSequences.some((sequence, index) =>
        index > 0 && sequence - (deletedSequences[index - 1] ?? sequence) > 1,
      ),
    ).toBe(true)
  })

  it('does not let delayed storm appends overwrite messages sent during the storm', () => {
    const feedId = 'feed-runtime'
    const baseMessages = createDemoMessages(3, feedId)
    const state = createEventStormState(baseMessages)
    const bufferedStormMessage = {
      ...createNewestMessage({
        feedId,
        sequence: 4,
      }),
      body: 'feed-runtime-m-4 buffered storm message',
    }
    const sentMessage = createOutgoingMessage('local send', {
      feedId,
      sequence: 4,
      quoteCandidates: baseMessages,
      random: () => 0.9,
    })
    const currentMessages = [...baseMessages, sentMessage]

    state.deliveryBuffer = [bufferedStormMessage]
    state.nextSequence = 5

    const result = applyEventStormTick({
      feedId,
      feedMessages: currentMessages,
      messages: currentMessages,
      hasMoreAfter: false,
      state,
      random: createRandomSource([
        0.1, // one event in this tick
        0.1, // choose append
        0.2, // reserve one extra storm append
        0.9, // keep normal storm kind
        0, // pick first storm text
        0, // pick first storm author
        0.9, // keep expanded state
        0.9, // no initial reaction
        0.2, // deliver one buffered append
        0.9, // do not hold newest buffered append
        0, // deliver the remapped conflicting append
        0.9, // no quote on delivery
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
          id: 'feed-runtime-m-5',
          body: 'feed-runtime-m-5 buffered storm message',
        }),
      ]),
    )
    expect(result.details.visibleOutOfOrderAppendCount).toBe(0)
    expect(result.details.visibleTailAppendCount).toBe(1)
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
      0.1, // one event in this tick
      0.99, // choose delete as the event kind
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
