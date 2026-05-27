import { describe, expect, it } from 'vitest'

import {
  createDemoMessages,
  createNewestMessage,
  getNextMessageSequence,
} from '../demoData'

describe('demoData', () => {
  it('uses generic mock shapes for appended messages', () => {
    const feedId = 'feed-append-shape'
    const seedMessages = createDemoMessages(20, feedId)
    let quoteCandidates = [...seedMessages]
    const appended = Array.from({ length: 4 }, () => {
      const message = createNewestMessage({
        feedId,
        sequence: getNextMessageSequence(quoteCandidates),
        quoteCandidates,
        random: () => 0.9,
      })

      quoteCandidates = [...quoteCandidates, message]
      return message
    })

    expect(new Set(appended.map((message) => message.body)).size)
      .toBeGreaterThan(1)
    expect(appended.every((message) => message.author !== 'You')).toBe(true)
    expect(appended.map((message) => message.kind)).toEqual([
      'text',
      'text',
      'video',
      'longText',
    ])
  })

  it('creates wider text and media height variance for stress scenarios', () => {
    const messages = createDemoMessages(200, 'feed-shape-amplitude')
    const maxLineCount = Math.max(
      ...messages.map((message) => message.body.split('\n').length),
    )
    const maxMediaHeight = Math.max(
      ...messages.map((message) => message.media?.height ?? 0),
    )

    expect(maxLineCount).toBeGreaterThanOrEqual(10)
    expect(maxMediaHeight).toBeGreaterThanOrEqual(560)
  })
})
