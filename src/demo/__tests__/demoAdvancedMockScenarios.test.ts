import { describe, expect, it } from 'vitest'

import {
  applyEventStormTick,
  createEventStormState,
} from '../demoAdvancedMockScenarios'
import { createDemoMessages, type DemoMessage } from '../demoData'

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
