import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMessageListSessionRegistry,
  type MessageListAdapter,
  type MessageListPage,
  type MessageListSession,
} from '../index'
import { getMessageListSessionInternals } from '../internal'
import { MessageListReadReceiptsWorker } from '../read-receipts/readReceipts'
import type {
  MessageListRuntimeEvent,
  ViewportObservationChangedEvent,
} from '../../runtime/index'
import { getMessageListAdapterRuntime } from '../../runtime/internal'
import { createContainer, setElementMetrics } from '../../../../test/fakes'

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

afterEach(() => {
  vi.useRealTimers()
})

describe('createMessageListSessionRegistry', () => {
  it('exposes registry naming, session meta, and host retain lifecycle', () => {
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      defaults: {
        keepAlive: {
          maxSessions: 0,
          ttlMs: 10 * 60_000,
        },
      },
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })

    const release = registry.retainSession('source-a', 'active-session')
    const activeMeta = registry.getSessionMeta('source-a')

    expect(activeMeta).toMatchObject({
      sessionId: 'source-a',
      mountedRetainCount: 0,
      hostRetainCount: 1,
      status: 'active',
    })

    release()

    expect(registry.getSessionMeta('source-a')).toMatchObject({
      hostRetainCount: 0,
      status: 'cached',
    })

    registry.destroyAll()
  })

  it('limits cached sessions without counting host-retained sessions', () => {
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      defaults: {
        keepAlive: {
          maxSessions: 1,
          ttlMs: 10 * 60_000,
        },
      },
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })

    const release = registry.retainSession('source-a', 'active-session')
    registry.getSession('source-b')
    registry.getSession('source-c')

    expect(registry.hasSession('source-a')).toBe(true)
    expect(registry.hasSession('source-b')).toBe(false)
    expect(registry.hasSession('source-c')).toBe(true)

    release()
    registry.getSession('source-d')

    expect(registry.hasSession('source-a')).toBe(false)
    expect(registry.hasSession('source-d')).toBe(true)
    registry.destroyAll()
  })

  it('lazily creates, routes, and reuses a warm session', async () => {
    const normalAdapter = createAdapter('normal')
    const favoriteAdapter = createAdapter('favorite')
    const getAdapter = vi.fn((conversation: TestConversation) =>
      conversation.type === 'favorite' ? favoriteAdapter : normalAdapter
    )
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({
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

  it('passes sessionId and source through request context', async () => {
    const loadLatest = vi.fn((context) => Promise.resolve(page([context.source.id])))
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'favorite' }),
      getAdapter: () => createAdapter('normal', { loadLatest }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)

    expect(loadLatest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'source-a',
      source: { id: 'source-a', type: 'favorite' },
      pageSize: 32,
    }))
  })

  it('evicts inactive overflow sessions by keepAlive policy', () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      defaults: {
        keepAlive: {
          maxSessions: 1,
          ttlMs: 10 * 60_000,
        },
      },
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })

    manager.getSession('source-a')
    manager.getSession('source-b')

    expect(manager.hasSession('source-a')).toBe(false)
    expect(manager.hasSession('source-b')).toBe(true)
    expect(manager.getSessionIds()).toEqual(['source-b'])
  })

  it('destroys sessions only through manager policy or explicit calls', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)

    expect(manager.destroySession('source-a')).toBe(true)
    expect(manager.destroySession('source-a')).toBe(false)
    expect(manager.hasSession('source-a')).toBe(false)
  })

  it('does not expose runtime internals as enumerable session fields', () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })
    const session = manager.getSession('source-a')

    expect(Object.keys(session)).not.toContain('runtime')
    expect(Object.keys(session)).not.toContain('loadedSegmentStore')
  })

  it('restores around an anchorMemory anchor before falling back to latest', async () => {
    const loadLatest = vi.fn(() => Promise.resolve(page(['latest'])))
    const loadAround = vi.fn((context) => Promise.resolve(
      page([context.target?.stableId ?? 'missing']),
    ))
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => ({
        ...createAdapter('normal', {
          loadLatest,
          loadAround,
        }),
        anchorMemory: {
          load: () => ({
            anchor: { id: 'restored' },
            offsetWithinMessage: 12,
          }),
          save: () => undefined,
        },
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)

    expect(loadLatest).not.toHaveBeenCalled()
    expect(loadAround).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'source-a',
      target: expect.objectContaining({
        sessionId: 'source-a',
        stableId: 'restored',
      }),
    }))
    expect(internals.getSnapshot().items[0].message?.id).toBe('restored')
    expect(internals.loadedSegmentStore.getSegment().modifier).toEqual(
      expect.objectContaining({
        type: 'reset-around',
        align: 'start',
        offsetWithinMessage: 12,
      }),
    )
  })

  it('publishes event-driven around requests instead of self-staling them', async () => {
    const requestResults: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: (context) => Promise.resolve(page([
          context.target?.stableId ?? 'missing-target',
        ], {
          hasMoreBefore: true,
          hasMoreAfter: true,
        })),
      }),
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.status}`)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)
    requestResults.length = 0

    session.commands.scrollToMessage({ id: 'remote' })

    await waitFor(() => internals.getSnapshot().items[0]?.message?.id === 'remote')

    expect(requestResults).toContain('around:applied')
    expect(requestResults).not.toContain('around:stale')
  })

  it('keeps around requests alive across same-generation live revisions', async () => {
    const pendingAround: Array<(page: MessageListPage<TestRow>) => void> = []
    const requestResults: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pendingAround.push(resolve)
        }),
      }),
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.status}`)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)
    requestResults.length = 0

    session.commands.scrollToMessage({ id: 'remote' })
    await waitFor(() => pendingAround.length === 1)
    session.rows.mutate({ patches: [{ id: 'normal-latest', text: 'edited' }] })
    pendingAround[0](page(['remote'], {
      hasMoreBefore: true,
      hasMoreAfter: true,
    }))

    await waitFor(() => internals.getSnapshot().items[0]?.message?.id === 'remote')

    expect(requestResults).toContain('around:applied')
    expect(requestResults).not.toContain('around:stale')
  })

  it('publishes event-driven latest requests instead of self-staling them', async () => {
    const requestResults: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['tail'])),
      }),
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.status}`)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)
    requestResults.length = 0

    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })
    session.commands.scrollToLatest()

    await waitFor(() => internals.getSnapshot().items[0]?.message?.id === 'tail')

    expect(internals.getSnapshot().segmentMeta.hasMoreAfter).toBe(false)
    expect(requestResults).toContain('latest:applied')
    expect(requestResults).not.toContain('latest:stale')
  })

  it('threads registry scrollMotion into runtime and disables follow-bottom and jump motion without rebuilding the session', async () => {
    const resolveMotionEnabled = vi.fn(() => false)
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      scrollMotion: {
        enabled: resolveMotionEnabled,
      },
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page([
          'row-1',
          'row-2',
          'row-3',
          'row-4',
          'row-5',
          'row-6',
        ])),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 6)
    const { container, rows } = attachSessionRows(session, [
      'row-1',
      'row-2',
      'row-3',
      'row-4',
      'row-5',
      'row-6',
    ])
    ackSessionCommit(session)
    container.scrollTop = 0
    positionRuntimeRows(rows, 0)

    session.commands.scrollToLatest()

    expect(resolveMotionEnabled).toHaveBeenCalledTimes(1)
    expect(internals.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
      pendingIntent: null,
    })
    expect(container.scrollTop).toBe(200)

    positionRuntimeRows(rows, 200)
    session.commands.scrollToMessage({ id: 'row-1' }, { align: 'start' })

    expect(resolveMotionEnabled).toHaveBeenCalledTimes(2)
    expect(internals.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'UNLOCKED',
      pendingIntent: null,
    })
    expect(container.scrollTop).toBe(0)
    expect(manager.getSession('source-a')).toBe(session)
  })

  it('exposes stable session state and publishes selector subscriptions', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['row-1', 'row-2'], {
          hasMoreBefore: true,
          hasMoreAfter: false,
        })),
      }),
    })
    const session = manager.getSession('source-a')
    const events: string[] = []
    const unsubscribe = session.subscribe(() => {
      events.push(session.getState().loaded.keys.join(','))
    })

    await waitFor(() => session.getState().loaded.keys.length === 2)
    const state = session.getState()

    expect(state).toBe(session.getState())
    expect(state).toMatchObject({
      sessionId: 'source-a',
      loaded: {
        keys: ['row-1', 'row-2'],
        hasMoreBefore: true,
        hasMoreAfter: false,
      },
      edge: {
        before: { status: 'idle' },
        after: { status: 'idle' },
      },
      overlayStatus: { status: 'idle' },
      viewport: {
        bottomLockState: 'UNLOCKED',
        pendingIntent: null,
      },
    })

    session.rows.mutate({ invalidateKeys: ['row-2'] })
    await waitFor(() => events.some((event) => event === 'row-1,row-2'))
    unsubscribe()
  })

  it('mutates only loaded rows and invalidates render versions without row data changes', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['row-10', 'row-11', 'row-12'])),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.getSnapshot().items.length === 3)
    ackSessionCommit(session)
    const before = internals.getSnapshot().items

    session.rows.mutate({
      patches: [
        { id: 'row-12', text: 'edited' },
        { id: 'missing', text: 'ignored' },
      ],
      removeKeys: ['row-11', 'outside-remove'],
      invalidateKeys: ['row-10', 'outside-invalidate'],
      reason: 'push-update',
    })

    const snapshot = internals.getSnapshot()
    expect(snapshot.items.map((item) => item.key)).toEqual(['row-10', 'row-12'])
    expect(snapshot.items[0]).not.toBe(before[0])
    expect(snapshot.items[0]?.message).toEqual({ id: 'row-10' })
    expect(snapshot.items[0]?.renderVersion).toBe(before[0].renderVersion + 1)
    expect(snapshot.items[1]?.message).toEqual({ id: 'row-12', text: 'edited' })
    expect(snapshot.segmentMeta.modifier).toEqual({
      type: 'patch',
      changedKeys: ['row-10', 'row-11', 'row-12'],
    })
    expect(session.getState().loaded.keys).toEqual(['row-10', 'row-12'])
  })

  it('routes command edge loads through runtime edge state', async () => {
    const pendingBefore: Array<(page: MessageListPage<TestRow>) => void> = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['row-2'], {
          hasMoreBefore: true,
          hasMoreAfter: false,
        })),
        loadBefore: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pendingBefore.push(resolve)
        }),
      }),
    })
    const session = manager.getSession('source-a')

    await waitFor(() => session.getState().loaded.keys.length === 1)
    ackSessionCommit(session)
    session.commands.loadBefore()
    await waitFor(() => session.getState().edge.before.status === 'loading')

    pendingBefore[0](page(['row-1'], {
      hasMoreBefore: false,
      hasMoreAfter: false,
    }))

    await waitFor(() => session.getState().loaded.keys[0] === 'row-1')
    ackSessionCommit(session)
    expect(session.getState().edge.before.status).toBe('exhausted')
  })

  it('does not let a pending bootstrap overwrite local reset rows', async () => {
    const pending: Array<(page: MessageListPage<TestRow>) => void> = []
    const requestResults: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pending.push(resolve)
        }),
      }),
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.status}`)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => pending.length === 1)

    session.rows.resetLatest(page(['local']))

    expect(internals.getSnapshot().items[0]?.message?.id).toBe('local')
    expect(internals.getViewState().overlayStatus.status).toBe('idle')

    pending[0](page(['bootstrap']))
    await wait()

    expect(internals.getSnapshot().items[0]?.message?.id).toBe('local')
    expect(requestResults).toEqual(['latest:stale'])
  })

  it('cancels bootstrap while anchor memory is still pending', async () => {
    let resolveMemory: ((value: null) => void) | null = null
    const loadLatest = vi.fn(() => Promise.resolve(page(['bootstrap'])))
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => ({
        ...createAdapter('normal', {
          loadLatest,
        }),
        anchorMemory: {
          load: () => new Promise<null>((resolve) => {
            resolveMemory = resolve
          }),
          save: () => undefined,
        },
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => Boolean(resolveMemory))

    session.rows.resetLatest(page(['local']))
    resolveMemory?.(null)
    await wait()

    expect(loadLatest).not.toHaveBeenCalled()
    expect(internals.getSnapshot().items[0]?.message?.id).toBe('local')
  })

  it('rejects concurrent edge responses once another edge advances segment revision', async () => {
    type NeedMoreEvent = Extract<MessageListRuntimeEvent, { edge: 'before' | 'after' }>
    const pendingBefore: Array<(page: MessageListPage<TestRow>) => void> = []
    const pendingAfter: Array<(page: MessageListPage<TestRow>) => void> = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadBefore: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pendingBefore.push(resolve)
        }),
        loadAfter: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pendingAfter.push(resolve)
        }),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    const bridge = session as unknown as {
      loadEdge(event: NeedMoreEvent): Promise<void>
    }

    await waitFor(() => internals.getSnapshot().items.length === 1)

    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })

    const segment = internals.loadedSegmentStore.getSegment()
    const beforeRequest = bridge.loadEdge({
      type: 'needMoreBefore',
      edge: 'before',
      sessionId: 'source-a',
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      requestToken: 'source-a:before:test',
      reason: 'test',
    })
    const afterRequest = bridge.loadEdge({
      type: 'needMoreAfter',
      edge: 'after',
      sessionId: 'source-a',
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      requestToken: 'source-a:after:test',
      reason: 'test',
    })

    await waitFor(() => pendingBefore.length === 1 && pendingAfter.length === 1)

    pendingBefore[0](page(['before'], {
      hasMoreBefore: false,
      hasMoreAfter: true,
      anchorId: 'middle',
    }))
    await beforeRequest

    expect(internals.loadedSegmentStore.getSegment().hasMoreBefore).toBe(false)

    pendingAfter[0](page(['after'], {
      hasMoreBefore: true,
      hasMoreAfter: false,
      anchorId: 'middle',
    }))
    await afterRequest

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['before', 'middle'])
    expect(internals.loadedSegmentStore.getSegment().hasMoreBefore).toBe(false)
    expect(internals.loadedSegmentStore.getSegment().hasMoreAfter).toBe(true)
  })

  it('rejects same-generation edge responses after local patches advance segment revision', async () => {
    type NeedMoreEvent = Extract<MessageListRuntimeEvent, { edge: 'before' | 'after' }>
    const pendingBefore: Array<(page: MessageListPage<TestRow>) => void> = []
    const requestResults: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadBefore: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pendingBefore.push(resolve)
        }),
      }),
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.status}`)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    const bridge = session as unknown as {
      loadEdge(event: NeedMoreEvent): Promise<void>
    }

    await waitFor(() => internals.getSnapshot().items.length === 1)
    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle', text: 'before patch' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })

    const segment = internals.loadedSegmentStore.getSegment()
    const request = bridge.loadEdge({
      type: 'needMoreBefore',
      edge: 'before',
      sessionId: 'source-a',
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      requestToken: 'source-a:before:test-stale-revision',
      reason: 'test',
    })

    await waitFor(() => pendingBefore.length === 1)

    session.rows.patch([{ id: 'middle', text: 'after patch' }])
    pendingBefore[0](page(['before'], {
      hasMoreBefore: false,
      hasMoreAfter: true,
      anchorId: 'middle',
    }))
    await request

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['middle'])
    expect(internals.loadedSegmentStore.getSegment().items[0]?.message?.text)
      .toBe('after patch')
    expect(requestResults).toContain('before:stale')
  })

  it('stages local tail rows into the current latest segment and keeps them patchable', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['tail'])),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items[0]?.message?.id === 'tail')

    const scrollToLatest = vi.spyOn(internals.runtime, 'scrollToLatest')
    session.tail.local.stage({ id: 'local', text: 'sending' })
    session.tail.local.patch([{ id: 'local', text: 'failed' }])
    session.tail.local.stage({
      rows: [{ id: 'local', text: 'retrying' }],
      reason: 'retry',
    })

    expect(scrollToLatest).toHaveBeenCalledTimes(2)
    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message))
      .toEqual([
        { id: 'tail' },
        { id: 'local', text: 'retrying' },
      ])
  })

  it('queues local tail rows from a non-latest segment and merges them into latest', async () => {
    const pendingLatest: Array<(page: MessageListPage<TestRow>) => void> = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pendingLatest.push(resolve)
        }),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => pendingLatest.length === 1)
    pendingLatest[0](page(['tail']))
    await waitFor(() => internals.loadedSegmentStore.getSegment().items[0]?.message?.id === 'tail')

    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })
    const scrollToLatest = vi.spyOn(internals.runtime, 'scrollToLatest')
    session.tail.local.stage({ id: 'local', text: 'sending' })

    expect(scrollToLatest).toHaveBeenCalledTimes(1)
    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['middle'])

    await waitFor(() => pendingLatest.length === 2)
    pendingLatest[1](page(['tail-2']))
    await waitFor(() =>
      internals.loadedSegmentStore.getSegment().items.some((item) =>
        item.message?.id === 'local'
      ),
    )

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['tail-2', 'local'])
    expect(internals.loadedSegmentStore.getSegment().hasMoreAfter).toBe(false)
  })

  it('uses local tail latest input to rebuild latest without requesting latest again', async () => {
    const loadLatest = vi.fn(() => Promise.resolve(page(['normal-latest'])))
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest,
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    const runtimeEvents: MessageListRuntimeEvent[] = []

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })
    const unsubscribe = internals.runtime.subscribeRuntimeEvent((event) => {
      runtimeEvents.push(event)
    })

    session.tail.local.stage({
      rows: [{ id: 'local' }],
      latest: page(['tail', 'local'], {
        hasMoreBefore: true,
        hasMoreAfter: false,
        anchorId: 'local',
      }),
    })
    unsubscribe()

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['tail', 'local'])
    expect(internals.loadedSegmentStore.getSegment().modifier.type).toBe('reset-latest')
    expect(loadLatest).toHaveBeenCalledTimes(1)
    expect(runtimeEvents.map((event) => event.type))
      .not.toContain('needLatestMessages')
    expect(internals.getSnapshot().pendingIntent).toBe('follow-bottom')
  })

  it('clears pending local tail rows when the host locally resets the segment', async () => {
    const pendingLatest: Array<(page: MessageListPage<TestRow>) => void> = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pendingLatest.push(resolve)
        }),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => pendingLatest.length === 1)
    pendingLatest[0](page(['tail']))
    await waitFor(() => internals.loadedSegmentStore.getSegment().items[0]?.message?.id === 'tail')

    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })
    session.tail.local.stage({ id: 'local', text: 'sending' })
    await waitFor(() => pendingLatest.length === 2)

    session.rows.clear()
    session.commands.reloadLatest()
    await waitFor(() => pendingLatest.length === 3)
    pendingLatest[2](page(['fresh']))

    await waitFor(() =>
      internals.loadedSegmentStore.getSegment().items[0]?.message?.id === 'fresh'
    )

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['fresh'])

    pendingLatest[1](page(['stale-tail']))
    await wait()

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['fresh'])
  })

  it('applies retireKeys while rebuilding latest from local tail latest input', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    session.rows.resetAround({
      target: { id: 'failed-local' },
      rows: [{ id: 'failed-local', text: 'failed' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'failed-local' },
    })

    session.tail.local.stage({
      rows: [{ id: 'retry-server', text: 'sent' }],
      latest: page(['tail', 'failed-local', 'retry-server'], {
        hasMoreBefore: true,
        hasMoreAfter: false,
        anchorId: 'retry-server',
      }),
      reason: 'retry',
      retireKeys: ['failed-local'],
    })

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['tail', 'retry-server'])
  })

  it('applies local tail identity remaps to visible local tail rows', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)

    session.tail.local.stage({ id: 'local' })
    session.tail.local.applyIdentityRemap([{
      from: { localId: 'local', stableId: 'local' },
      to: { serverId: 'server', stableId: 'server' },
      previousKey: 'local',
      nextKey: 'server',
    }])

    expect(internals.loadedSegmentStore.getSegment().modifier).toEqual(
      expect.objectContaining({ type: 'identity-remap' }),
    )
    expect(internals.loadedSegmentStore.getSegment().items.at(-1)).toMatchObject({
      key: 'server',
      identity: expect.objectContaining({
        stableId: 'server',
        serverId: 'server',
      }),
    })
  })

  it('stages retry success with an atomic retire and send-style follow decision', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['tail', 'failed-local'])),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() =>
      internals.loadedSegmentStore.getSegment().items.at(-1)?.message?.id === 'failed-local'
    )

    session.tail.local.stage({
      rows: [{ id: 'retry-server', text: 'sent' }],
      reason: 'retry',
      retireKeys: ['failed-local'],
    })

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['tail', 'retry-server'])
    expect(internals.loadedSegmentStore.getSegment().modifier).toEqual({
      type: 'append',
      changedKeys: ['failed-local', 'retry-server'],
      follow: 'follow',
      retireKeys: ['failed-local'],
    })
  })

  it('routes remote tail append through the configured follow policy', async () => {
    const shouldFollowRemoteAppend = vi.fn(() => 'preserve' as const)
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['tail'])),
      }),
      tailEvents: {
        getPageFocus: () => false,
        shouldFollowRemoteAppend,
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items[0]?.message?.id === 'tail')

    session.tail.remote.append({
      rows: [{ id: 'remote' }],
      reason: 'push',
    })

    expect(shouldFollowRemoteAppend).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'source-a',
      rows: [{ id: 'remote' }],
      reason: 'push',
      pageFocused: false,
      hasMoreAfter: false,
      distanceToBottom: expect.any(Number),
    }))
    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['tail', 'remote'])
    expect(internals.loadedSegmentStore.getSegment().modifier).toEqual({
      type: 'append',
      changedKeys: ['remote'],
      follow: 'preserve',
    })
  })

  it('routes remote tail append through updated tailEvents policy', async () => {
    const shouldFollowRemoteAppend = vi.fn(() => 'preserve' as const)
    const getPageFocus = vi.fn(() => false)
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['tail'])),
      }),
      tailEvents: {
        getPageFocus,
        shouldFollowRemoteAppend: () => 'follow',
      },
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items[0]?.message?.id === 'tail')

    registry.updateOptions({
      tailEvents: {
        shouldFollowRemoteAppend,
      },
    })

    session.tail.remote.append({
      rows: [{ id: 'remote' }],
      reason: 'push',
    })

    expect(shouldFollowRemoteAppend).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'source-a',
      rows: [{ id: 'remote' }],
      reason: 'push',
      pageFocused: false,
    }))
    expect(getPageFocus).toHaveBeenCalled()
    expect(internals.loadedSegmentStore.getSegment().modifier).toEqual({
      type: 'append',
      changedKeys: ['remote'],
      follow: 'preserve',
    })
  })

  it('keeps local tail rows patchable through canonical tail API', async () => {
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['tail'])),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items[0]?.message?.id === 'tail')

    session.tail.local.stage({ id: 'local', text: 'sending' })
    session.tail.local.patch([{ id: 'local', text: 'sent' }])

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message))
      .toEqual([
        { id: 'tail' },
        { id: 'local', text: 'sent' },
      ])
  })

  it('does not insert remote tail append into a non-latest segment', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })

    session.tail.remote.append({ id: 'remote' })

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['middle'])
    expect(internals.loadedSegmentStore.getSegment().modifier.type).toBe('reset-around')
  })

  it('rejects stale bootstrap/reload responses without overwriting newer rows', async () => {
    const pending: Array<(page: MessageListPage<TestRow>) => void> = []
    const adapter = createAdapter('normal', {
      loadLatest: () => new Promise<MessageListPage<TestRow>>((resolve) => {
        pending.push(resolve)
      }),
    })
    const requestResults: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => adapter,
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.status}`)
      },
    })
    const session = manager.getSession('source-a')
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

  it('keeps overlay idle when a bootstrap request finishes before the delay', async () => {
    vi.useFakeTimers()
    const pending: Array<(page: MessageListPage<TestRow>) => void> = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pending.push(resolve)
        }),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await flushMicrotasks()
    expect(pending).toHaveLength(1)
    expect(internals.getViewState().overlayStatus.status).toBe('idle')

    pending[0](page(['latest']))
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(250)

    expect(internals.getViewState().overlayStatus.status).toBe('idle')
    expect(internals.getSnapshot().items[0]?.message?.id).toBe('latest')
  })

  it('publishes overlay loading only after a slow request crosses the delay', async () => {
    vi.useFakeTimers()
    const pending: Array<(page: MessageListPage<TestRow>) => void> = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pending.push(resolve)
        }),
      }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)

    await flushMicrotasks()
    expect(pending).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(199)
    expect(internals.getViewState().overlayStatus.status).toBe('idle')

    await vi.advanceTimersByTimeAsync(1)
    expect(internals.getViewState().overlayStatus.status).toBe('loading')

    pending[0](page(['latest']))
    await flushMicrotasks()

    expect(internals.getViewState().overlayStatus.status).toBe('idle')
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

function page(
  ids: string[],
  options: Partial<Pick<
    MessageListPage<TestRow>,
    'hasMoreBefore' | 'hasMoreAfter'
  >> & {
    anchorId?: string
  } = {},
): MessageListPage<TestRow> {
  return {
    rows: ids.map((id) => ({ id })),
    hasMoreBefore: options.hasMoreBefore ?? false,
    hasMoreAfter: options.hasMoreAfter ?? false,
    anchor: options.anchorId
      ? { id: options.anchorId }
      : ids.at(-1) ? { id: ids.at(-1) } : undefined,
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

function ackSessionCommit(session: MessageListSession<TestRow>): void {
  const internals = getMessageListSessionInternals(session)
  getMessageListAdapterRuntime(internals.runtime)
    .ackProjectionCommit(internals.runtime.getSnapshot().commitToken)
}

function attachSessionRows(
  session: MessageListSession<TestRow>,
  ids: string[],
): { container: HTMLDivElement; rows: HTMLDivElement[] } {
  const internals = getMessageListSessionInternals(session)
  const adapter = getMessageListAdapterRuntime(internals.runtime)
  const container = createContainer({ height: 100 })
  const rows = createRuntimeRows(ids, 50)

  container.append(...rows)
  internals.runtime.attachScrollContainer(container)
  for (const row of rows) {
    adapter.registerRowElement(row.dataset.runtimeKey as string, row)
  }

  return { container, rows }
}

function observation(keys: string[]): ViewportObservationChangedEvent {
  return {
    type: 'viewportObservationChanged',
    sessionId: 'source-a',
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
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

function createRuntimeRows(ids: string[], height: number): HTMLDivElement[] {
  return ids.map((id, index) => {
    const row = document.createElement('div')
    row.dataset.runtimeKey = id
    row.dataset.rowKind = 'message'
    row.dataset.messageStableId = id
    row.dataset.messageServerId = id
    setElementMetrics(row, { top: index * height, height })
    return row
  })
}

function positionRuntimeRows(rows: HTMLDivElement[], scrollTop: number): void {
  rows.forEach((row, index) => {
    setElementMetrics(row, {
      top: index * 50 - scrollTop,
      height: 50,
    })
  })
}
