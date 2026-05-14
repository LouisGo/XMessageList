import { describe, expect, it } from 'vitest'
import {
  createDemoSnapshot,
  createDemoMessages,
  createOlderMessages,
  createOutgoingMessage,
  getFirstMessageSequence,
  getNextMessageSequence,
} from '../demoData'

describe('demoData', () => {
  it('keeps message identity isolated by feed id', () => {
    const left = createDemoMessages(2, 'feed-left')
    const right = createDemoMessages(2, 'feed-right')

    expect(left.map((message) => message.id)).toEqual([
      'feed-left-m-1',
      'feed-left-m-2',
    ])
    expect(right.map((message) => message.id)).toEqual([
      'feed-right-m-1',
      'feed-right-m-2',
    ])
  })

  it('creates older messages in chronological order before the current first row', () => {
    const current = createDemoMessages(3, 'feed-history', 10)
    const older = createOlderMessages(3, {
      feedId: 'feed-history',
      beforeSequence: getFirstMessageSequence(current),
    })

    expect(older.map((message) => message.sequence)).toEqual([7, 8, 9])
    expect([...older, ...current].map((message) => message.sequence)).toEqual([
      7, 8, 9, 10, 11, 12,
    ])
  })

  it('uses the next sequence for outgoing messages', () => {
    const current = createDemoMessages(3, 'feed-send')
    const outgoing = createOutgoingMessage('hello', {
      feedId: 'feed-send',
      sequence: getNextMessageSequence(current),
    })

    expect(outgoing.id).toBe('feed-send-m-4')
    expect(outgoing.author).toBe('You')
  })

  it('can project an empty feed snapshot for clear-message scenarios', () => {
    const snapshot = createDemoSnapshot({
      feedId: 'feed-empty',
      generation: 2,
      messages: [],
      revision: 5,
      effect: 'reset',
      kind: 'reset',
    })

    expect(snapshot.items).toEqual([])
    expect(snapshot.anchor).toBeUndefined()
    expect(snapshot.hasMoreBefore).toBe(false)
  })

  it('keeps history available by default for seeded non-empty feeds', () => {
    const messages = createDemoMessages(1, 'feed-seeded')
    const snapshot = createDemoSnapshot({
      feedId: 'feed-seeded',
      generation: 1,
      messages,
      revision: 1,
      effect: 'reset',
      kind: 'initial',
    })

    expect(snapshot.hasMoreBefore).toBe(true)
  })

  it('keeps an explicit anchor and anchorStatus when restore data resolves to a neighbor', () => {
    const messages = createDemoMessages(3, 'feed-restore')
    const snapshot = createDemoSnapshot({
      feedId: 'feed-restore',
      generation: 1,
      messages,
      revision: 2,
      effect: 'reset',
      kind: 'initial',
      anchor: {
        messageId: messages[1]?.id ?? '',
        position: messages[1]?.sequence,
      },
      anchorStatus: 'deleted',
      hasMoreBefore: true,
      hasMoreAfter: true,
    })

    expect(snapshot.anchor).toEqual({
      messageId: messages[1]?.id ?? '',
      position: messages[1]?.sequence,
    })
    expect(snapshot.anchorStatus).toBe('deleted')
    expect(snapshot.hasMoreAfter).toBe(true)
  })
})
