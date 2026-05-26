import { describe, expect, it } from 'vitest'
import type { MessageDataItem } from '../../identity'
import { createMessageListDataRuntime } from '../index'

describe('MessageListDataRuntime', () => {
  it('remaps optimistic local identity to server identity', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('local-1', { localId: 'client-1', stableId: 'stable-1' })],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })

    const segment = runtime.applyIdentityRemap([{
      from: { feedId: 'feed-a', stableId: 'stable-1', localId: 'client-1' },
      to: { feedId: 'feed-a', stableId: 'stable-1', serverId: 'server-1' },
      previousKey: 'local-1',
      nextKey: 'server-1',
    }])

    expect(segment.items[0]?.key).toBe('server-1')
    expect(segment.items[0]?.identity?.serverId).toBe('server-1')
    expect(segment.segmentRevision).toBe(2)
    expect(segment.modifier.type).toBe('identity-remap')
  })

  it('keeps fallback anchor metadata on around reset', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    const segment = runtime.resetAround({
      target: { feedId: 'feed-a', stableId: 'deleted-1' },
      anchor: { feedId: 'feed-a', stableId: 'fallback-1' },
      anchorStatus: 'deleted',
      items: [item('fallback-1')],
      hasMoreBefore: true,
      hasMoreAfter: true,
    })

    expect(segment.anchorStatus).toBe('deleted')
    expect(segment.modifier).toMatchObject({ type: 'reset-around' })
  })

  it('dedupes duplicate server messages during after merge', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1', { serverId: 'server-1', stableId: 'stable-1' })],
      hasMoreBefore: false,
      hasMoreAfter: true,
    })
    const request = runtime.createRequestToken('after')
    const result = runtime.extendAfter({
      requestToken: request.requestToken,
      items: [
        item('duplicate-key', { serverId: 'server-1', stableId: 'stable-copy' }),
        item('row-2', { serverId: 'server-2', stableId: 'stable-2' }),
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })

    expect(result.applied).toBe(true)
    expect(result.segment.items.map((nextItem) => nextItem.key)).toEqual([
      'row-1',
      'row-2',
    ])
  })

  it('adopts viewport request tokens for semantic edge events', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })

    runtime.adoptRequestToken({
      requestToken: 'feed-a:before:runtime-1',
      generation: 1,
      kind: 'before',
    })

    const result = runtime.extendBefore({
      requestToken: 'feed-a:before:runtime-1',
      items: [item('row-0')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })

    expect(result.applied).toBe(true)
    expect(result.segment.items.map((nextItem) => nextItem.key)).toEqual([
      'row-0',
      'row-1',
    ])
  })

  it('drops stale responses after generation reset and trims around anchor', () => {
    const runtime = createMessageListDataRuntime<string>({
      feedId: 'feed-a',
      itemBudget: 3,
    })
    runtime.resetLatest({
      items: [item('row-1'), item('row-2')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })
    const staleRequest = runtime.createRequestToken('before')
    runtime.resetLatest({
      items: [item('row-3'), item('row-4'), item('row-5'), item('row-6')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })

    const staleResult = runtime.extendBefore({
      requestToken: staleRequest.requestToken,
      items: [item('stale')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })
    const trimmed = runtime.trimToBudget('row-5')

    expect(staleResult).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })
    expect(trimmed.items.map((nextItem) => nextItem.key)).toEqual([
      'row-4',
      'row-5',
      'row-6',
    ])
    expect(trimmed.hasMoreBefore).toBe(true)
  })
})

function item(
  key: string,
  identity: Partial<MessageDataItem<string>['identity']> = {},
): MessageDataItem<string> {
  return {
    key,
    rowKind: 'message',
    renderVersion: 1,
    message: key,
    identity: {
      feedId: 'feed-a',
      stableId: key,
      version: 1,
      ...identity,
    },
  }
}
