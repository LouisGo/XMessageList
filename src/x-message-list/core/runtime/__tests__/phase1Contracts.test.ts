import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type MessageListMotionDirection,
  type MessageListScrollMotionHint,
  type ScrollMotionOptions,
} from '../index'
import { expect, it } from 'vitest'

it('exposes MessageList runtime contracts without legacy viewport names', () => {
  const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
  const item: MessageDataItem<string> = {
    key: 'row-1',
    rowKind: 'message',
    renderVersion: 1,
    message: 'hello',
    identity: {
      feedId: 'feed-a',
      stableId: 'm1',
      serverId: 'm1',
      version: 1,
    },
  }
  const segment: LoadedSegment<string> = {
    feedId: 'feed-a',
    generation: 1,
    segmentRevision: 1,
    items: [item],
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'bootstrap' },
  }

  runtime.applyLoadedSegment(segment)
  const motionDirection: MessageListMotionDirection = 'before'
  const motionHint: MessageListScrollMotionHint = { direction: motionDirection }
  const scrollMotion: ScrollMotionOptions = { enabled: true }

  expect(runtime.getSnapshot().items).toEqual([item])
  expect(motionHint.direction).toBe('before')
  expect(scrollMotion.enabled).toBe(true)
  expect(runtime.getEvidence()).toMatchObject({
    feedId: 'feed-a',
    modifier: 'bootstrap',
    hasMoreBefore: false,
    hasMoreAfter: false,
  })
})
