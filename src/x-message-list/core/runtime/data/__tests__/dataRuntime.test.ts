import { describe, expect, it } from 'vitest'
import type { MessageDataItem } from '../../contracts/identity'
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
      segmentRevision: 1,
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

  it('rejects request tokens used for the wrong semantic request kind', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1')],
      hasMoreBefore: true,
      hasMoreAfter: true,
    })
    const latest = runtime.createRequestToken('latest')
    const before = runtime.createRequestToken('before')

    expect(runtime.extendBefore({
      requestToken: latest.requestToken,
      items: [item('wrong-kind-before')],
      hasMoreBefore: false,
      hasMoreAfter: true,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })
    expect(runtime.resetLatestFromRequest({
      requestToken: before.requestToken,
      items: [item('wrong-kind-latest')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })
    expect(runtime.getSegment().items.map((nextItem) => nextItem.key)).toEqual([
      'row-1',
    ])
  })

  it('drops stale latest and around request responses', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1')],
      hasMoreBefore: false,
      hasMoreAfter: true,
    })
    const latest = runtime.createRequestToken('latest')
    const around = runtime.createRequestToken('around')

    runtime.resetLatest({
      items: [item('row-2')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })

    expect(runtime.resetLatestFromRequest({
      requestToken: latest.requestToken,
      items: [item('stale-latest')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })
    expect(runtime.resetAroundFromRequest({
      requestToken: around.requestToken,
      target: { feedId: 'feed-a', stableId: 'stale-around' },
      items: [item('stale-around')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })
    expect(runtime.getSegment().items.map((nextItem) => nextItem.key)).toEqual([
      'row-2',
    ])
  })

  it('lets the newest same-generation destination request win', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1')],
      hasMoreBefore: false,
      hasMoreAfter: true,
    })
    const first = runtime.createRequestToken('around')
    const second = runtime.createRequestToken('around')

    expect(runtime.resetAroundFromRequest({
      requestToken: first.requestToken,
      target: { feedId: 'feed-a', stableId: 'row-2' },
      items: [item('row-2')],
      hasMoreBefore: true,
      hasMoreAfter: true,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })

    const applied = runtime.resetAroundFromRequest({
      requestToken: second.requestToken,
      target: { feedId: 'feed-a', stableId: 'row-3' },
      items: [item('row-3')],
      hasMoreBefore: true,
      hasMoreAfter: true,
    })

    expect(applied.applied).toBe(true)
    expect(applied.segment.items.map((nextItem) => nextItem.key)).toEqual([
      'row-3',
    ])
  })

  it('keeps a newer current token after an older same-kind token is rejected', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })
    const first = runtime.createRequestToken('before')
    const second = runtime.createRequestToken('before')

    expect(runtime.extendBefore({
      requestToken: first.requestToken,
      items: [item('stale-before')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })
    expect(runtime.extendBefore({
      requestToken: second.requestToken,
      items: [item('row-0')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })).toMatchObject({ applied: true })
    expect(runtime.getSegment().items.map((nextItem) => nextItem.key)).toEqual([
      'row-0',
      'row-1',
    ])
  })

  it('rejects same-generation edge responses after the segment revision changes', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })
    const request = runtime.createRequestToken('before')

    runtime.patchItems([item('row-1')])

    expect(runtime.extendBefore({
      requestToken: request.requestToken,
      items: [item('stale-before')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })
    expect(runtime.getSegment().items.map((nextItem) => nextItem.key)).toEqual([
      'row-1',
    ])
  })

  it('lets destination reset tokens supersede pending edge tokens', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })
    const before = runtime.createRequestToken('before')

    runtime.adoptRequestToken({
      requestToken: 'feed-a:around:runtime-1',
      generation: 1,
      segmentRevision: 1,
      kind: 'around',
    })

    expect(runtime.extendBefore({
      requestToken: before.requestToken,
      items: [item('stale-before')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })
    expect(runtime.resetAroundFromRequest({
      requestToken: 'feed-a:around:runtime-1',
      target: { feedId: 'feed-a', stableId: 'row-9' },
      items: [item('row-9')],
      hasMoreBefore: true,
      hasMoreAfter: true,
    })).toMatchObject({ applied: true })
  })

  it('clears request registry state on reset and accepts new generation tokens', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1')],
      hasMoreBefore: false,
      hasMoreAfter: true,
    })
    const stale = runtime.createRequestToken('latest')

    runtime.resetAround({
      target: { feedId: 'feed-a', stableId: 'row-9' },
      items: [item('row-9')],
      hasMoreBefore: true,
      hasMoreAfter: true,
    })

    expect(runtime.resetLatestFromRequest({
      requestToken: stale.requestToken,
      items: [item('stale-latest')],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })).toMatchObject({
      applied: false,
      reason: 'stale-request',
    })

    const current = runtime.createRequestToken('latest')
    const applied = runtime.resetLatestFromRequest({
      requestToken: current.requestToken,
      items: [item('row-10')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })

    expect(applied.applied).toBe(true)
    expect(applied.segment.items.map((nextItem) => nextItem.key)).toEqual([
      'row-10',
    ])
  })

  it('replaces the loaded item window for host-owned mock mutations', () => {
    const runtime = createMessageListDataRuntime<string>({ feedId: 'feed-a' })
    runtime.resetLatest({
      items: [item('row-1'), item('row-2'), item('row-3')],
      hasMoreBefore: true,
      hasMoreAfter: false,
    })

    const segment = runtime.replaceItems({
      items: [item('row-1'), item('row-3')],
      changedKeys: ['row-2'],
    })

    expect(segment.items.map((nextItem) => nextItem.key)).toEqual([
      'row-1',
      'row-3',
    ])
    expect(segment.modifier).toEqual({
      type: 'patch',
      changedKeys: ['row-2'],
    })
    expect(segment.hasMoreBefore).toBe(true)
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

  it('trims a single side per modifier when the protected anchor is central', () => {
    const runtime = createMessageListDataRuntime<string>({
      feedId: 'feed-a',
      itemBudget: 3,
    })
    runtime.resetLatest({
      items: Array.from({ length: 10 }, (_, index) => item(`row-${index + 1}`)),
      hasMoreBefore: false,
      hasMoreAfter: false,
    })

    const firstTrim = runtime.trimToBudget('row-6')

    expect(firstTrim.modifier.type).toBe('trim-before')
    expect(firstTrim.items.map((nextItem) => nextItem.key)).toEqual([
      'row-6',
      'row-7',
      'row-8',
      'row-9',
      'row-10',
    ])
    expect(firstTrim.hasMoreBefore).toBe(true)
    expect(firstTrim.hasMoreAfter).toBe(false)

    const secondTrim = runtime.trimToBudget('row-6')

    expect(secondTrim.modifier.type).toBe('trim-after')
    expect(secondTrim.items.map((nextItem) => nextItem.key)).toEqual([
      'row-6',
      'row-7',
      'row-8',
    ])
    expect(secondTrim.hasMoreBefore).toBe(true)
    expect(secondTrim.hasMoreAfter).toBe(true)
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
