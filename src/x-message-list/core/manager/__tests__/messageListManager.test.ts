import { describe, expect, it, vi } from 'vitest'
import {
  createMessageListManager,
  type MessageListAdapter,
  type MessageListPage,
} from '../index'
import { getMessageListSessionInternals } from '../internal'
import { MessageListReadReceiptsWorker } from '../readReceipts'
import type { ViewportObservationChangedEvent } from '../../runtime/index'

type TestRow = {
  id: string
  text?: string
  unread?: boolean
}

type TestConversation = {
  id: string
  type: 'normal' | 'favorite'
  encrypted?: boolean
}

describe('createMessageListManager', () => {
  it('lazily creates, routes, and reuses a warm session', async () => {
    const normalAdapter = createAdapter('normal')
    const favoriteAdapter = createAdapter('favorite')
    const getAdapter = vi.fn((conversation: TestConversation) =>
      conversation.type === 'favorite' ? favoriteAdapter : normalAdapter
    )
    const manager = createMessageListManager<TestRow, TestConversation>({
      getConversation: (id) => ({
        id,
        type: id.startsWith('favorite') ? 'favorite' : 'normal',
      }),
      getAdapter,
    })

    expect(manager.hasSession('favorite-1')).toBe(false)

    const session = manager.getSession('favorite-1')
    const sameSession = manager.getSession('favorite-1')
    const internals = getMessageListSessionInternals(session)

    expect(session).toBe(sameSession)
    expect(manager.hasSession('favorite-1')).toBe(true)
    expect(getAdapter).toHaveBeenCalledWith({
      id: 'favorite-1',
      type: 'favorite',
    })

    await waitFor(() => internals.getSnapshot().items.length === 1)
    expect(internals.getSnapshot().items[0].message?.id)
      .toBe('favorite-latest')
  })

  it('evicts inactive overflow sessions by keepAlive policy', () => {
    const manager = createMessageListManager<TestRow, TestConversation>({
      defaults: {
        keepAlive: {
          maxSessions: 1,
          ttlMs: 10 * 60_000,
        },
      },
      getConversation: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })

    manager.getSession('feed-a')
    manager.getSession('feed-b')

    expect(manager.hasSession('feed-a')).toBe(false)
    expect(manager.hasSession('feed-b')).toBe(true)
    expect(manager.getSessionIds()).toEqual(['feed-b'])
  })

  it('destroys sessions only through manager policy or explicit calls', async () => {
    const manager = createMessageListManager<TestRow, TestConversation>({
      getConversation: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })
    const session = manager.getSession('feed-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)

    expect(manager.destroySession('feed-a')).toBe(true)
    expect(manager.destroySession('feed-a')).toBe(false)
    expect(manager.hasSession('feed-a')).toBe(false)
  })

  it('restores around an anchorMemory anchor before falling back to latest', async () => {
    const loadLatest = vi.fn(() => Promise.resolve(page(['latest'])))
    const loadAround = vi.fn((context) => Promise.resolve(
      page([context.target?.stableId ?? 'missing']),
    ))
    const manager = createMessageListManager<TestRow, TestConversation>({
      getConversation: (id) => ({ id, type: 'normal' }),
      getAdapter: () => ({
        ...createAdapter('normal', {
          loadLatest,
          loadAround,
        }),
        anchorMemory: {
          load: () => ({ id: 'restored' }),
          save: () => undefined,
        },
      }),
    })
    const session = manager.getSession('feed-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)

    expect(loadLatest).not.toHaveBeenCalled()
    expect(loadAround).toHaveBeenCalledWith(expect.objectContaining({
      id: 'feed-a',
      target: expect.objectContaining({
        feedId: 'feed-a',
        stableId: 'restored',
      }),
    }))
    expect(internals.getSnapshot().items[0].message?.id).toBe('restored')
  })

  it('rejects stale bootstrap/reload responses without overwriting newer rows', async () => {
    const pending: Array<(page: MessageListPage<TestRow>) => void> = []
    const adapter = createAdapter('normal', {
      loadLatest: () => new Promise<MessageListPage<TestRow>>((resolve) => {
        pending.push(resolve)
      }),
    })
    const requestResults: string[] = []
    const manager = createMessageListManager<TestRow, TestConversation>({
      getConversation: (id) => ({ id, type: 'normal' }),
      getAdapter: () => adapter,
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.status}`)
      },
    })
    const session = manager.getSession('feed-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => pending.length === 1)
    session.commands.reloadLatest()
    await waitFor(() => pending.length === 2)
    pending[1](page(['new']))

    await waitFor(() => internals.getSnapshot().items[0]?.message?.id === 'new')

    pending[0](page(['old']))
    await wait()

    expect(internals.getSnapshot().items[0]?.message?.id).toBe('new')
    expect(requestResults).toEqual(['latest:applied', 'latest:stale'])
  })
})

describe('MessageListReadReceiptsWorker', () => {
  it('batches visible rows and dedupes already sent keys', async () => {
    const markRead = vi.fn((rows: TestRow[]) => {
      void rows
      return Promise.resolve()
    })
    const worker = new MessageListReadReceiptsWorker(
      createAdapter('normal', {
        readReceipts: {
          batchDelayMs: 0,
          shouldMarkRead: (row) => Boolean(row.unread),
          markRead,
        },
      }),
      rowsByKey([
        { id: 'a', unread: true },
        { id: 'b', unread: true },
        { id: 'c', unread: true },
        { id: 'read', unread: false },
      ]),
    )

    worker.handleObservation(observation(['a', 'b', 'a', 'read']))

    await waitFor(() => markRead.mock.calls.length === 1)
    expect(markRead.mock.calls[0][0].map((row) => row.id)).toEqual(['a', 'b'])

    worker.handleObservation(observation(['a', 'c']))

    await waitFor(() => markRead.mock.calls.length === 2)
    expect(markRead.mock.calls[1][0].map((row) => row.id)).toEqual(['c'])
    worker.destroy()
  })

  it('serializes in-flight markRead calls before flushing the next batch', async () => {
    let resolveFirst: (() => void) | null = null
    const markRead = vi.fn((rows: TestRow[]) => {
      if (rows[0]?.id === 'a') {
        return new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }

      return Promise.resolve()
    })
    const worker = new MessageListReadReceiptsWorker(
      createAdapter('normal', {
        readReceipts: {
          batchDelayMs: 0,
          markRead,
        },
      }),
      rowsByKey([{ id: 'a' }, { id: 'b' }]),
    )

    worker.handleObservation(observation(['a']))
    await waitFor(() => markRead.mock.calls.length === 1)

    worker.handleObservation(observation(['b']))
    await wait(20)

    expect(markRead).toHaveBeenCalledTimes(1)

    resolveFirst?.()
    await waitFor(() => markRead.mock.calls.length === 2)

    expect(markRead.mock.calls[1][0].map((row) => row.id)).toEqual(['b'])
    worker.destroy()
  })
})

function createAdapter(
  label: string,
  overrides: Partial<MessageListAdapter<TestRow, TestConversation>['request']> & {
    readReceipts?: MessageListAdapter<TestRow, TestConversation>['readReceipts']
  } = {},
): MessageListAdapter<TestRow, TestConversation> {
  return {
    row: {
      getKey: (row) => row.id,
      getAnchor: (row) => ({ id: row.id }),
      getVersion: (row) => row.text,
    },
    request: {
      loadLatest: overrides.loadLatest ?? (() => Promise.resolve(
        page([`${label}-latest`]),
      )),
      loadBefore: overrides.loadBefore ?? (() => Promise.resolve(page([]))),
      loadAfter: overrides.loadAfter ?? (() => Promise.resolve(page([]))),
      loadAround: overrides.loadAround ?? ((context) => Promise.resolve(
        page([context.target?.stableId ?? `${label}-around`]),
      )),
    },
    readReceipts: overrides.readReceipts,
  }
}

function page(ids: string[]): MessageListPage<TestRow> {
  return {
    rows: ids.map((id) => ({ id })),
    hasMoreBefore: false,
    hasMoreAfter: false,
    anchor: ids.at(-1) ? { id: ids.at(-1) } : undefined,
  }
}

function rowsByKey(rows: TestRow[]): (keys: string[]) => TestRow[] {
  const map = new Map(rows.map((row) => [row.id, row]))

  return (keys) => {
    const nextRows: TestRow[] = []

    for (const key of keys) {
      const row = map.get(key)

      if (row) {
        nextRows.push(row)
      }
    }

    return nextRows
  }
}

function observation(keys: string[]): ViewportObservationChangedEvent {
  return {
    type: 'viewportObservationChanged',
    feedId: 'feed-a',
    generation: 1,
    segmentRevision: 1,
    reason: 'scroll-idle',
    scrollSource: 'user',
    direction: 'none',
    activity: 'settling',
    anchor: null,
    visibleRange: {
      firstKey: keys[0] ?? null,
      lastKey: keys.at(-1) ?? null,
    },
    visibleItems: keys.map((key) => ({
      key,
      visibleRatio: 1,
    })),
    visibleKeys: keys,
  }
}

async function wait(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return
    }

    await wait(10)
  }

  expect(condition()).toBe(true)
}
