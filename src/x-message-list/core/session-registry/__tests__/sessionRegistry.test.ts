import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMessageListSessionRegistry,
  type MessageListAdapter,
  type MessageListPage,
  type MessageListRuntimeLogDiagnosticRecord,
  type MessageListSession,
} from '../index'
import { getMessageListSessionInternals } from '../internal'
import { MessageListReadReceiptsWorker } from '../read-receipts/readReceipts'
import type {
  MessageDataItem,
  MessageListRuntimeEvent,
  ViewportObservationChangedEvent,
} from '../../runtime/index'
import {
  getMessageListAdapterRuntime,
  getMessageListSessionRegistryRuntime,
} from '../../runtime/internal'
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
    startSession(session)

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

  it('keeps getSession lazy until a view retain starts bootstrap', async () => {
    const loadLatest = vi.fn(() => Promise.resolve(page(['latest'])))
    const anchorLoad = vi.fn(() => null)
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => ({
        ...createAdapter('normal', { loadLatest }),
        anchorMemory: {
          load: anchorLoad,
          save: () => undefined,
        },
      }),
    })
    const session = registry.getSession('source-a')

    await flushMicrotasks()

    expect(anchorLoad).not.toHaveBeenCalled()
    expect(loadLatest).not.toHaveBeenCalled()

    startSession(session)

    await waitFor(() => loadLatest.mock.calls.length === 1)

    expect(anchorLoad).toHaveBeenCalledTimes(1)
    expect(session.getState().loaded.keys).toEqual(['latest'])
  })

  it('starts bootstrap once across repeated view retains', async () => {
    const loadLatest = vi.fn(() => Promise.resolve(page(['latest'])))
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadLatest }),
    })
    const session = registry.getSession('source-a')

    const releaseFirst = getMessageListSessionInternals(session).retainView()
    releaseFirst()
    const releaseSecond = getMessageListSessionInternals(session).retainView()
    releaseSecond()

    await waitFor(() => loadLatest.mock.calls.length === 1)

    expect(session.getState().loaded.keys).toEqual(['latest'])
  })

  it('starts bootstrap for host prefetch retains while preserving cache policy', async () => {
    const loadLatest = vi.fn(() => Promise.resolve(page(['latest'])))
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      defaults: {
        keepAlive: {
          maxSessions: 1,
          ttlMs: 10 * 60_000,
        },
      },
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadLatest }),
    })

    const release = registry.retainSession('source-a', 'prefetch')

    await waitFor(() => loadLatest.mock.calls.length === 1)

    release()

    expect(registry.getSessionMeta('source-a')).toMatchObject({
      status: 'cached',
      hostRetainCount: 0,
    })
    expect(registry.hasSession('source-a')).toBe(true)
  })

  it('passes sessionId and source through request context', async () => {
    const loadLatest = vi.fn((context) => Promise.resolve(page([context.source.id])))
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'favorite' }),
      getAdapter: () => createAdapter('normal', { loadLatest }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)

    expect(loadLatest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'source-a',
      source: { id: 'source-a', type: 'favorite' },
      pageSize: 32,
      trigger: 'internal',
    }))
  })

  it('passes command request trigger through adapter context and request result', async () => {
    const loadLatest = vi.fn(() => Promise.resolve(page(['latest'])))
    const requestResults: string[] = []
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadLatest }),
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.trigger}:${result.status}`)
      },
    })
    const session = registry.getSession('source-a')
    startSession(session)
    await waitFor(() => loadLatest.mock.calls.length === 1)

    session.commands.reloadLatest()
    await waitFor(() => loadLatest.mock.calls.length === 2)
    await waitFor(() => requestResults.includes('latest:command:applied'))

    expect(loadLatest).toHaveBeenLastCalledWith(expect.objectContaining({
      trigger: 'command',
    }))
    expect(requestResults).toContain('latest:command:applied')
  })

  it('rejects invalid latest pages with stable diagnostics', async () => {
    const diagnostics: string[] = []
    const requestResults: string[] = []
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['bad-latest'], {
          hasMoreAfter: true,
          reachedLatest: true,
        })),
      }),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.trigger}:${result.status}`)
      },
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => requestResults.includes('latest:internal:failed'))

    expect(diagnostics).toContain('page.latestHasMoreAfter')
    expect(diagnostics).toContain('page.reachedLatestHasMoreAfter')
    expect(internals.loadedSegmentStore.getSegment().items).toEqual([])
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
    startSession(session)

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
    startSession(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)

    expect(loadLatest).not.toHaveBeenCalled()
    expect(loadAround).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'source-a',
      trigger: 'restore',
      target: expect.objectContaining({
        sessionId: 'source-a',
        stableId: 'restored',
      }),
    }))
    expect(internals.getSnapshot().items[0].message?.id).toBe('restored')
    expect(internals.loadedSegmentStore.getSegment().context).toBe('history')
    expect(internals.loadedSegmentStore.getSegment().modifier).toEqual(
      expect.objectContaining({
        type: 'reset-around',
        align: 'start',
        offsetWithinMessage: 12,
      }),
    )
  })

  it('promotes history to latest when after paging reaches latest without command follow-bottom', async () => {
    const loadAfter = vi.fn(() => Promise.resolve(page(['tail'], {
      reachedLatest: true,
      hasMoreAfter: false,
    })))
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadAfter }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    attachSessionRows(session, ['normal-latest'])
    ackSessionCommit(session)
    await waitFor(() => internals.getSnapshot().viewportPhase === 'IDLE')
    const historySegment = internals.loadedSegmentStore.resetAround({
      target: { sessionId: 'source-a', stableId: 'restored' },
      items: [testDataItem('restored')],
      hasMoreBefore: true,
      hasMoreAfter: true,
      context: 'history',
    })
    internals.runtime.applyLoadedSegment(historySegment)
    await (session as unknown as {
      loadEdge(event: MessageListRuntimeEvent): Promise<void>
    }).loadEdge({
      type: 'needMoreAfter',
      edge: 'after',
      sessionId: 'source-a',
      generation: historySegment.generation,
      segmentRevision: historySegment.segmentRevision,
      requestToken: 'source-a:after:history-test',
      reason: 'command-after',
    })
    await waitFor(() => internals.loadedSegmentStore.getSegment().context === 'latest')

    expect(loadAfter).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'command',
      boundaryRow: { id: 'restored' },
    }))
    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['restored', 'tail'])
    expect(internals.getSnapshot().pendingIntent).not.toBe('follow-bottom')
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
    startSession(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)
    requestResults.length = 0

    session.commands.scrollToMessage({ id: 'remote' })

    await waitFor(() => internals.getSnapshot().items[0]?.message?.id === 'remote')

    expect(requestResults).toContain('around:applied')
    expect(requestResults).not.toContain('around:stale')
  })

  it('keeps around context when around request reports reachedLatest', async () => {
    const diagnostics: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => Promise.resolve(page(['target'], {
          reachedLatest: true,
          hasMoreAfter: false,
        })),
      }),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    session.commands.scrollToMessage({ id: 'target' })
    await waitFor(() =>
      internals.loadedSegmentStore.getSegment().items[0]?.message?.id === 'target'
    )

    expect(diagnostics).toContain('aroundReachedLatestIgnored')
    expect(internals.loadedSegmentStore.getSegment().context).toBe('around')
  })

  it('downgrades invalid viewport trigger on non-edge requests', async () => {
    const diagnostics: string[] = []
    const requestResults: string[] = []
    const loadAround = vi.fn(() => Promise.resolve(page(['target'])))
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadAround }),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.trigger}:${result.status}`)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    await (session as unknown as {
      loadAround(
        target: { sessionId: string; stableId: string },
        event: undefined,
        options: { trigger: 'viewport' },
      ): Promise<void>
    }).loadAround({ sessionId: 'source-a', stableId: 'target' }, undefined, {
      trigger: 'viewport',
    })

    expect(diagnostics).toContain('requestTrigger.invalidViewportUse')
    expect(loadAround).toHaveBeenLastCalledWith(expect.objectContaining({
      trigger: 'internal',
    }))
    expect(requestResults).toContain('around:internal:applied')
  })

  it('rejects reachedLatest pages that still report hasMoreAfter', async () => {
    const diagnostics: string[] = []
    const requestResults: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => Promise.resolve(page(['target'], {
          reachedLatest: true,
          hasMoreAfter: true,
        })),
      }),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
      onRequestResult: (result) => {
        requestResults.push(`${result.kind}:${result.status}`)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    session.commands.scrollToMessage({ id: 'target' })
    await waitFor(() => requestResults.includes('around:failed'))

    expect(diagnostics).toContain('page.reachedLatestHasMoreAfter')
    expect(internals.loadedSegmentStore.getSegment().items[0]?.message?.id)
      .not.toBe('target')
  })

  it('forwards runtime events as serializable log events', async () => {
    const runtimeEvents: Array<{
      type: string
      sessionId?: string
      requestToken?: string
      target?: { stableId?: string }
    }> = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
      onRuntimeEvent: (event) => {
        runtimeEvents.push(event)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)
    session.commands.scrollToMessage({ id: 'remote' })

    await waitFor(() =>
      runtimeEvents.some((event) =>
        event.type === 'needMessagesAround' &&
        event.sessionId === 'source-a' &&
        event.target?.stableId === 'remote' &&
        typeof event.requestToken === 'string'
      )
    )
    manager.destroyAll()
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
    startSession(session)

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
    startSession(session)

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

  it('loads latest when scrollToLatest starts from around context without after edge', async () => {
    const loadLatest = vi.fn(() => Promise.resolve(page(['tail'])))
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadLatest }),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.getSnapshot().items.length === 1)
    loadLatest.mockClear()
    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: false,
      anchor: { id: 'middle' },
    })

    session.commands.scrollToLatest()

    await waitFor(() => internals.getSnapshot().items[0]?.message?.id === 'tail')

    expect(loadLatest).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'command',
    }))
    expect(internals.getSnapshot().segmentMeta.context).toBe('latest')
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
    startSession(session)

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
    startSession(session)

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

  it('publishes viewport distance subscriptions only for meaningful observation changes', async () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)

    let reportedDistance = 40
    const observedDistances: number[] = []
    const unsubscribe = session.subscribe(() => {
      observedDistances.push(session.getState().viewport.distanceToBottom)
    })
    const emitObservation = () => {
      ;(internals.runtime as unknown as {
        emitRuntimeEvent(event: MessageListRuntimeEvent): void
      }).emitRuntimeEvent(observation([], reportedDistance))
    }

    emitObservation()
    emitObservation()
    reportedDistance = 40.25
    emitObservation()
    reportedDistance = 41
    emitObservation()

    expect(observedDistances).toEqual([40, 41])
    expect(session.getState().viewport.distanceToBottom).toBe(41)
    unsubscribe()
  })

  it('keeps missing-key rows.patch upserts while reporting their deprecated use', async () => {
    const diagnostics: MessageListRuntimeLogDiagnosticRecord[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(['existing'])),
      }),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => session.getState().loaded.keys[0] === 'existing')
    ackSessionCommit(session)

    session.rows.patch([
      { id: 'existing', text: 'patched' },
      { id: 'missing-a' },
      { id: 'missing-b' },
      { id: 'missing-a', text: 'duplicate input' },
    ])
    ackSessionCommit(session)

    expect(session.getState().loaded.keys).toEqual([
      'existing',
      'missing-a',
      'missing-b',
    ])
    expect(internals.loadedSegmentStore.getSegment().items[1]?.message)
      .toEqual({ id: 'missing-a' })
    expect(diagnostics).toContainEqual(expect.objectContaining({
      name: 'rows.patch.missingKeyUpsertDeprecated',
      severity: 'warn',
      details: expect.objectContaining({
        missingKeys: ['missing-a', 'missing-b'],
      }),
    }))
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
    startSession(session)

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
      type: 'remove',
      changedKeys: ['row-10', 'row-12'],
      removedKeys: ['row-11'],
      removed: [{
        key: 'row-11',
        previousIndex: 1,
        successorKey: 'row-12',
        predecessorKey: 'row-10',
      }],
      firstAffectedIndex: 1,
      reason: 'push-update',
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
    startSession(session)

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
    startSession(session)

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
    startSession(session)

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
    startSession(session)

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

  it('applies same-generation edge responses across content-only patches', async () => {
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
    startSession(session)

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
      .toEqual(['before', 'middle'])
    expect(internals.loadedSegmentStore.getSegment().items[1]?.message?.text)
      .toBe('after patch')
    expect(requestResults).toContain('before:applied')
  })

  it('settles an edge response after a content patch without poisoning edge state', async () => {
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

    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length === 1)
    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle', text: 'before patch' }],
      hasMoreBefore: true,
      hasMoreAfter: false,
      anchor: { id: 'middle' },
    })
    attachSessionRows(session, ['middle'])
    ackSessionCommit(session)

    const runtime = getMessageListSessionRegistryRuntime(internals.runtime)
    runtime.startEdgeRequest('before', 'test')
    await waitFor(() => pendingBefore.length === 1)
    expect(internals.getSnapshot().edgeState.before.status).toBe('loading')

    session.rows.patch([{ id: 'middle', text: 'after patch' }])
    ackSessionCommit(session)
    pendingBefore[0](page(['before'], {
      hasMoreBefore: false,
      hasMoreAfter: false,
      anchorId: 'middle',
    }))

    await waitFor(() => requestResults.includes('before:applied'))
    ackSessionCommit(session)
    expect(internals.getSnapshot().edgeState.before.status).toBe('exhausted')
    expect(internals.getSnapshot().items.map((item) => item.key))
      .toEqual(['before', 'middle'])
  })

  it('trims oversized reset-around segments until the adaptive budget is reached', () => {
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      defaults: {
        pageSize: 2,
        retention: 'low',
      },
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: `row-${index + 1}`,
    }))

    session.rows.resetAround({
      target: { id: 'row-20' },
      rows,
      hasMoreBefore: false,
      hasMoreAfter: false,
      anchor: { id: 'row-20' },
    })

    const segment = internals.loadedSegmentStore.getSegment()

    expect(segment.items).toHaveLength(8)
    expect(segment.items.map((item) => item.key)).toContain('row-20')
    expect(segment.hasMoreBefore).toBe(true)
    expect(segment.hasMoreAfter).toBe(true)
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
    startSession(session)

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

  it('rejects local tail rows from a non-latest segment without a latest baseline', async () => {
    const pendingLatest: Array<(page: MessageListPage<TestRow>) => void> = []
    const diagnostics: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => new Promise<MessageListPage<TestRow>>((resolve) => {
          pendingLatest.push(resolve)
        }),
      }),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

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

    expect(scrollToLatest).toHaveBeenCalledTimes(0)
    expect(diagnostics).toContain('localTailStage.missingLatest')
    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['middle'])
    expect(pendingLatest).toHaveLength(1)
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
    startSession(session)

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
      latest: page(['tail'], {
        hasMoreBefore: true,
        hasMoreAfter: false,
        anchorId: 'tail',
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

  it('rejects local tail latest baseline that duplicates staged row keys', async () => {
    const diagnostics: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })

    session.tail.local.stage({
      rows: [{ id: 'local' }],
      latest: page(['tail', 'local']),
    })

    expect(diagnostics).toContain('localTailStage.duplicateRowKey')
    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['middle'])
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
    startSession(session)

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
    session.tail.local.stage({
      rows: [{ id: 'local', text: 'sending' }],
      latest: page(['tail-2']),
    })
    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['tail-2', 'local'])

    session.rows.clear()
    session.commands.reloadLatest()
    await waitFor(() => pendingLatest.length === 2)
    pendingLatest[1](page(['fresh']))

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
    startSession(session)

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
      latest: page(['tail', 'failed-local'], {
        hasMoreBefore: true,
        hasMoreAfter: false,
        anchorId: 'failed-local',
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
    startSession(session)

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
    startSession(session)

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
    startSession(session)

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
    startSession(session)

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
    startSession(session)

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
    const diagnostics: string[] = []
    const manager = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
    })
    const session = manager.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)

    await waitFor(() => internals.loadedSegmentStore.getSegment().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' },
      rows: [{ id: 'middle' }],
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })

    session.tail.remote.append({ id: 'remote' })

    expect(diagnostics).toContain('remoteTailAppend.outsideLatestContext')
    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.message?.id))
      .toEqual(['middle'])
    expect(internals.loadedSegmentStore.getSegment().modifier.type).toBe('reset-around')
  })

  it('does not bridge a missing latest boundary with remote tail append', async () => {
    const diagnostics: string[] = []
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal'),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    internals.loadedSegmentStore.resetLatest({
      items: [testDataItem('loaded-before-gap')],
      hasMoreBefore: true,
      hasMoreAfter: true,
    })

    session.tail.remote.append({ id: 'remote-after-gap' })

    expect(internals.loadedSegmentStore.getSegment().items.map((item) => item.key))
      .toEqual(['loaded-before-gap'])
    expect(diagnostics).toContain('remoteTailAppend.outsideLatestContext')
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
    startSession(session)

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
    startSession(session)

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
    startSession(session)

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

describe('reloadCurrent', () => {
  it.each([
    { hasMoreAfter: true, expectedContext: 'history' as const },
    { hasMoreAfter: false, expectedContext: 'latest' as const },
  ])('reloads an unlocked latest anchor into $expectedContext context', async ({
    hasMoreAfter,
    expectedContext,
  }) => {
    const ids = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6']
    const loadAround = vi.fn((context) => Promise.resolve({
      rows: ids.map((id) => ({ id, text: 'fresh' })),
      hasMoreBefore: true,
      hasMoreAfter,
      anchor: context.target,
    }))
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadLatest: () => Promise.resolve(page(ids)),
        loadAround,
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length === ids.length)
    const { rows } = attachSessionRows(session, ids)
    positionRuntimeRows(rows, 20)
    ackSessionCommit(session)
    expect(internals.getSnapshot().bottomLockState).toBe('UNLOCKED')

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => internals.getSnapshot().items[0]?.message?.text === 'fresh')
    expect(internals.getSnapshot().segmentMeta.modifier).toMatchObject({
      type: 'reset-around',
      align: 'start',
      offsetWithinMessage: 20,
    })
    ackSessionCommit(session)

    await expect(resultPromise).resolves.toMatchObject({
      status: 'applied', requestKind: 'around', resolution: 'exact',
    })
    expect(session.getState().loaded.context).toBe(expectedContext)
  })

  it('silently reloads a locked latest window and resolves only after structural settle', async () => {
    let loadCount = 0
    let resolveReload: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6']
    const loadLatest = vi.fn(() => {
      loadCount += 1
      if (loadCount === 1) return Promise.resolve(page(ids))
      return new Promise<MessageListPage<TestRow>>((resolve) => {
        resolveReload = resolve
      })
    })
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      scrollMotion: { enabled: false },
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadLatest }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length === ids.length)
    const { rows } = attachSessionRows(session, ids)
    ackSessionCommit(session)
    positionRuntimeRows(rows, 0)
    session.commands.scrollToLatest()
    expect(internals.getSnapshot().bottomLockState).toBe('LOCKED')

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => loadLatest.mock.calls.length === 2)
    expect(internals.getViewState().overlayStatus.status).toBe('idle')
    expect(internals.getSnapshot().items[0]?.message?.text).toBeUndefined()
    resolveReload?.({
      rows: ids.map((id) => ({ id, text: 'fresh' })),
      hasMoreBefore: false,
      hasMoreAfter: false,
      anchor: { id: ids.at(-1) },
    })
    await waitFor(() => internals.getSnapshot().items[0]?.message?.text === 'fresh')
    ackSessionCommit(session)

    const result = await resultPromise
    expect(result).toMatchObject({
      status: 'applied',
      requestKind: 'latest',
    })
    expect(result.status === 'applied' && result.page.rows[0]).toEqual(
      expect.objectContaining({ text: 'fresh' }),
    )
    expect(internals.getSnapshot().bottomLockState).toBe('LOCKED')
  })

  it('reloads the visible around anchor, rebases a concurrent delete, and resolves after commit', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const loadAround = vi.fn(() => new Promise<MessageListPage<TestRow>>((resolve) => {
      resolveAround = resolve
    }))
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadAround }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    const currentIds = ['middle', 'a', 'b', 'other', 'c', 'd']
    session.rows.resetAround({
      target: { id: 'middle' },
      rows: currentIds.map((id) => ({ id })),
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })
    const { rows } = attachSessionRows(session, currentIds)
    positionRuntimeRows(rows, 20)
    ackSessionCommit(session)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => loadAround.mock.calls.length === 1)
    expect(loadAround).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'command',
      reason: 'structural',
      target: expect.objectContaining({ stableId: 'middle' }),
      signal: expect.any(AbortSignal),
    }))
    session.rows.mutate({ removeKeys: ['other'], reason: 'deleted' })
    ackSessionCommit(session)
    resolveAround?.({
      rows: currentIds.map((id) => ({
        id,
        text: id === 'middle' ? 'fresh' : undefined,
      })),
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: { id: 'middle' },
    })
    await waitFor(() => internals.getSnapshot().items[0]?.message?.text === 'fresh')
    let settled = false
    void resultPromise.then(() => { settled = true })
    await flushMicrotasks()
    expect(settled).toBe(false)
    ackSessionCommit(session)

    await expect(resultPromise).resolves.toMatchObject({
      status: 'applied',
      requestKind: 'around',
      resolution: 'exact',
      resolvedAnchor: expect.objectContaining({ stableId: 'middle' }),
    })
    expect(session.getState().loaded.keys).toEqual(['middle', 'a', 'b', 'c', 'd'])
  })

  it.each(['local', 'remote'] as const)(
    'rebases a legal %s tail append without dropping it from the response',
    async (tailKind) => {
      let loadCount = 0
      let resolveReload: ((page: MessageListPage<TestRow>) => void) | null = null
      const ids = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6']
      const loadLatest = vi.fn(() => {
        loadCount += 1
        if (loadCount === 1) return Promise.resolve(page(ids))
        return new Promise<MessageListPage<TestRow>>((resolve) => {
          resolveReload = resolve
        })
      })
      const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
        scrollMotion: { enabled: false },
        getSessionSource: (id) => ({ id, type: 'normal' }),
        getAdapter: () => createAdapter('normal', { loadLatest }),
      })
      const session = registry.getSession('source-a')
      const internals = getMessageListSessionInternals(session)
      startSession(session)
      await waitFor(() => internals.getSnapshot().items.length === ids.length)
      const { rows } = attachSessionRows(session, ids)
      ackSessionCommit(session)
      positionRuntimeRows(rows, 0)
      session.commands.scrollToLatest()

      const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
      await waitFor(() => loadLatest.mock.calls.length === 2)
      if (tailKind === 'local') {
        session.tail.local.stage({ id: 'tail-during-request' })
      } else {
        session.tail.remote.append({
          rows: [{ id: 'tail-during-request' }],
          follow: 'preserve',
        })
      }
      ackSessionCommit(session)
      resolveReload?.({
        rows: ids.map((id) => ({ id, text: 'fresh' })),
        hasMoreBefore: true,
        hasMoreAfter: false,
        anchor: { id: ids.at(-1) },
      })
      await waitFor(() =>
        internals.getSnapshot().items[0]?.message?.text === 'fresh' &&
        internals.getSnapshot().items.at(-1)?.key === 'tail-during-request'
      )
      ackSessionCommit(session)

      const result = await resultPromise
      expect(result).toMatchObject({ status: 'applied', requestKind: 'latest' })
      expect(result.status === 'applied' && result.page.rows.map((row) => row.id))
        .toEqual([...ids, 'tail-during-request'])
    },
  )

  it('rebases identity remap key and identity onto the returned page projection', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['local', 'a', 'b', 'c', 'd', 'e']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise((resolve) => { resolveAround = resolve }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'local' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'local' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => resolveAround !== null)
    session.rows.applyIdentityRemap([{
      from: { id: 'local' },
      to: { id: 'server' },
      previousKey: 'local',
      nextKey: 'server',
    }])
    ackSessionCommit(session)
    resolveAround?.({
      rows: ids.map((id) => ({ id, text: 'fresh' })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'local' },
    })
    await waitFor(() =>
      internals.getSnapshot().items[0]?.key === 'server' &&
      internals.getSnapshot().items[0]?.message?.text === 'fresh'
    )
    ackSessionCommit(session)

    await expect(resultPromise).resolves.toMatchObject({
      status: 'applied',
      resolution: 'exact',
      resolvedAnchor: expect.objectContaining({ stableId: 'server' }),
    })
    expect(internals.getSnapshot().items[0]).toMatchObject({
      key: 'server',
      identity: expect.objectContaining({ stableId: 'server' }),
      message: { id: 'local', text: 'fresh' },
    })
  })

  it('replays patch upserts in operation order after server rows', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise((resolve) => { resolveAround = resolve }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => resolveAround !== null)
    session.rows.patch([
      { id: 'b', text: 'locally patched' },
      { id: 'upsert-1' },
      { id: 'upsert-2' },
    ])
    session.rows.patch([{ id: 'upsert-1', text: 'patched again' }])
    ackSessionCommit(session)
    resolveAround?.({
      rows: ids.map((id) => ({ id, text: 'server' })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    await waitFor(() =>
      internals.getSnapshot().items.at(-1)?.key === 'upsert-2' &&
      internals.getSnapshot().items[2]?.message?.text === 'locally patched'
    )
    ackSessionCommit(session)

    const result = await resultPromise
    expect(result.status === 'applied' && result.page.rows.map((row) => row.id))
      .toEqual([...ids, 'upsert-1', 'upsert-2'])
    expect(internals.getSnapshot().items.at(-2)?.message?.text)
      .toBe('patched again')
  })

  it('falls back to the deletion successor when the exact target is removed', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['middle', 'successor', 'a', 'b', 'c', 'd']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise((resolve) => { resolveAround = resolve }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => resolveAround !== null)
    session.rows.mutate({ removeKeys: ['middle'], reason: 'deleted' })
    ackSessionCommit(session)
    resolveAround?.({
      rows: ids.map((id) => ({ id, text: 'fresh' })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    await waitFor(() => internals.getSnapshot().items[0]?.key === 'successor')
    ackSessionCommit(session)

    await expect(resultPromise).resolves.toMatchObject({
      status: 'applied',
      resolution: 'fallback',
      resolvedAnchor: expect.objectContaining({ stableId: 'successor' }),
    })
    expect(session.getState().loaded.keys).not.toContain('middle')
  })

  it('falls back again when the server fallback row is concurrently removed', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['middle', 'fallback', 'successor', 'a', 'b', 'c']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise((resolve) => { resolveAround = resolve }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => resolveAround !== null)
    session.rows.mutate({ removeKeys: ['fallback'], reason: 'deleted' })
    ackSessionCommit(session)
    resolveAround?.({
      rows: ids.slice(1).map((id) => ({ id, text: 'fresh' })),
      hasMoreBefore: true,
      hasMoreAfter: true,
      anchor: {
        id: 'middle',
        fallbackStableId: 'fallback',
        fallbackReason: 'deleted',
      },
      anchorStatus: 'deleted',
    })
    await waitFor(() => internals.getSnapshot().items[0]?.key === 'successor')
    ackSessionCommit(session)

    await expect(resultPromise).resolves.toMatchObject({
      status: 'applied',
      resolution: 'fallback',
      resolvedAnchor: expect.objectContaining({ stableId: 'successor' }),
    })
    expect(session.getState().loaded.keys).not.toContain('fallback')
  })

  it('prefers an appended retry replacement when the retired target was the tail', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['a', 'b', 'c', 'd', 'e', 'failed-tail']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise((resolve) => { resolveAround = resolve }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetLatest(page(ids, {
      hasMoreBefore: true,
      hasMoreAfter: false,
      anchorId: 'failed-tail',
    }))
    const { rows } = attachSessionRows(session, ids)
    positionRuntimeRows(rows, 250)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => resolveAround !== null)
    session.tail.local.stage({
      rows: [{ id: 'retry-server' }],
      reason: 'retry',
      retireKeys: ['failed-tail'],
    })
    ackSessionCommit(session)
    resolveAround?.({
      rows: ids.map((id) => ({ id, text: 'fresh' })),
      hasMoreBefore: true, hasMoreAfter: false, anchor: { id: 'failed-tail' },
    })
    await waitFor(() => internals.getSnapshot().items.at(-1)?.key === 'retry-server')
    ackSessionCommit(session)

    await expect(resultPromise).resolves.toMatchObject({
      status: 'applied',
      resolution: 'fallback',
      resolvedAnchor: expect.objectContaining({ stableId: 'retry-server' }),
    })
  })

  it('stales on journal overflow without publishing the eventual response', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise((resolve) => { resolveAround = resolve }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => resolveAround !== null)
    session.rows.patch(Array.from({ length: 257 }, (_, index) => ({
      id: `overflow-${index}`,
    })))
    await expect(resultPromise).resolves.toMatchObject({
      status: 'stale', staleReason: 'topology-changed',
    })
    const generation = internals.getSnapshot().generation
    resolveAround?.({
      rows: ids.map((id) => ({ id, text: 'must-not-publish' })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    await flushMicrotasks()
    expect(internals.getSnapshot().generation).toBe(generation)
  })

  it('stales when a topology mutation lands during projection settling', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise((resolve) => { resolveAround = resolve }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => resolveAround !== null)
    resolveAround?.({
      rows: ids.map((id) => ({ id, text: 'fresh' })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    await waitFor(() => internals.getSnapshot().items[0]?.message?.text === 'fresh')
    session.rows.patch([{ id: 'settling-upsert' }])

    await expect(resultPromise).resolves.toMatchObject({
      status: 'stale', staleReason: 'topology-changed',
    })
    expect(internals.loadedSegmentStore.getSegment().items.at(-1)?.key)
      .toBe('settling-upsert')
  })

  it('classifies local stage with an authoritative latest page as topology stale', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => new Promise((resolve) => { resolveAround = resolve }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => resolveAround !== null)
    session.tail.local.stage({
      rows: [{ id: 'local' }],
      latest: page(['authoritative-latest']),
    })

    await expect(resultPromise).resolves.toMatchObject({
      status: 'stale', staleReason: 'topology-changed',
    })
  })

  it('aborts and returns one stale result when the session is destroyed', async () => {
    let requestSignal: AbortSignal | undefined
    const loadAround = vi.fn((context) => {
      requestSignal = context.signal
      return new Promise<MessageListPage<TestRow>>(() => undefined)
    })
    const requestResults: string[] = []
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadAround }),
      onRequestResult: (result) => requestResults.push(`${result.kind}:${result.status}`),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)

    const resultPromise = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => loadAround.mock.calls.length === 1)
    registry.destroySession('source-a')

    await expect(resultPromise).resolves.toEqual({
      status: 'stale',
      requestKind: 'around',
      staleReason: 'session-destroyed',
    })
    expect(requestSignal?.aborted).toBe(true)
    expect(requestResults.filter((result) => result === 'around:stale')).toHaveLength(1)
  })

  it('lets a second reload supersede the first and aborts the older signal', async () => {
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    const pending: Array<{
      signal?: AbortSignal
      resolve: (page: MessageListPage<TestRow>) => void
    }> = []
    const loadAround = vi.fn((context) => new Promise<MessageListPage<TestRow>>((resolve) => {
      pending.push({ signal: context.signal, resolve })
    }))
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadAround }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)
    ackSessionCommit(session)

    const first = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => pending.length === 1)
    const second = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => pending.length === 2)
    await expect(first).resolves.toMatchObject({
      status: 'stale', staleReason: 'superseded',
    })
    expect(pending[0].signal?.aborted).toBe(true)
    pending[1].resolve({
      rows: ids.map((id) => ({ id, text: id === 'middle' ? 'second' : undefined })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    await waitFor(() => internals.getSnapshot().items[0]?.message?.text === 'second')
    ackSessionCommit(session)
    await expect(second).resolves.toMatchObject({ status: 'applied' })
  })

  it('stales synchronously on viewport navigation intent without publishing the response', async () => {
    let resolveAround: ((page: MessageListPage<TestRow>) => void) | null = null
    const loadAround = vi.fn(() => new Promise<MessageListPage<TestRow>>((resolve) => {
      resolveAround = resolve
    }))
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadAround }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)
    ackSessionCommit(session)
    const before = internals.getSnapshot()
    const result = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => loadAround.mock.calls.length === 1)

    ;(internals.runtime as unknown as {
      emitRuntimeEvent(event: MessageListRuntimeEvent): void
    }).emitRuntimeEvent({
      type: 'viewportNavigationIntent',
      sessionId: 'source-a',
      generation: before.generation,
      segmentRevision: before.segmentRevision,
      reason: 'user-scroll',
    })
    await expect(result).resolves.toMatchObject({
      status: 'stale', staleReason: 'navigation-changed',
    })
    resolveAround?.({
      rows: ids.map((id) => ({ id, text: 'must-not-publish' })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    await flushMicrotasks()
    expect(internals.getSnapshot().generation).toBe(before.generation)
    expect(internals.getSnapshot().items[0]?.message?.text).toBeUndefined()
  })

  it('rejects a deleted page without fallback and accepts a deterministic fallback', async () => {
    let requestCount = 0
    const loadAround = vi.fn(() => {
      requestCount += 1
      return Promise.resolve(requestCount === 1
        ? {
            rows: [{ id: 'fallback' }], hasMoreBefore: true, hasMoreAfter: true,
            anchor: { id: 'middle' }, anchorStatus: 'deleted' as const,
          }
        : {
            rows: [{ id: 'fallback' }], hasMoreBefore: true, hasMoreAfter: true,
            anchor: {
              id: 'middle', fallbackStableId: 'fallback', fallbackReason: 'deleted' as const,
            },
            anchorStatus: 'deleted' as const,
          })
    })
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', { loadAround }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)
    ackSessionCommit(session)
    const generation = internals.getSnapshot().generation

    await expect(session.commands.reloadCurrent({ reason: 'structural' }))
      .resolves.toMatchObject({
        status: 'failed', failureReason: 'contract-violation',
      })
    expect(internals.getSnapshot().generation).toBe(generation)

    const valid = session.commands.reloadCurrent({ reason: 'structural' })
    await waitFor(() => internals.getSnapshot().items[0]?.key === 'fallback')
    ackSessionCommit(session)
    await expect(valid).resolves.toMatchObject({
      status: 'applied',
      resolution: 'fallback',
      resolvedAnchor: expect.objectContaining({ stableId: 'fallback' }),
    })
  })

  it('returns commit-timeout when the structural projection is not acknowledged', async () => {
    const ids = ['middle', 'a', 'b', 'c', 'd', 'e']
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        loadAround: () => Promise.resolve({
          rows: ids.map((id) => ({ id, text: id === 'middle' ? 'fresh' : undefined })),
          hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
        }),
      }),
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    session.rows.resetAround({
      target: { id: 'middle' }, rows: ids.map((id) => ({ id })),
      hasMoreBefore: true, hasMoreAfter: true, anchor: { id: 'middle' },
    })
    attachSessionRows(session, ids)
    ackSessionCommit(session)
    ackSessionCommit(session)

    await expect(session.commands.reloadCurrent({ reason: 'structural' }))
      .resolves.toMatchObject({
        status: 'failed', failureReason: 'commit-timeout',
      })
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

describe('anchorMemory writer', () => {
  it('serializes saves, coalesces to latest, and captures rejection diagnostics', async () => {
    let resolveFirst: (() => void) | null = null
    const diagnostics: string[] = []
    const save = vi.fn((_context, value) => {
      if (value.anchor.stableId === 'a') {
        return new Promise<void>((resolve) => { resolveFirst = resolve })
      }
      return Promise.reject(new Error('persistence unavailable'))
    })
    const registry = createMessageListSessionRegistry<TestRow, TestConversation>({
      getSessionSource: (id) => ({ id, type: 'normal' }),
      getAdapter: () => createAdapter('normal', {
        anchorMemory: { load: () => null, save },
      }),
      onRuntimeEvent: (event) => {
        if (event.diagnostic) diagnostics.push(event.diagnostic.name)
      },
    })
    const session = registry.getSession('source-a')
    const internals = getMessageListSessionInternals(session)
    startSession(session)
    await waitFor(() => internals.getSnapshot().items.length > 0)
    const snapshot = internals.getSnapshot()
    const emitAnchor = (id: string) => {
      ;(internals.runtime as unknown as {
        emitRuntimeEvent(event: MessageListRuntimeEvent): void
      }).emitRuntimeEvent({
        type: 'viewportAnchorChanged', sessionId: 'source-a',
        generation: snapshot.generation, segmentRevision: snapshot.segmentRevision,
        reason: 'scroll-idle', anchor: { sessionId: 'source-a', stableId: id },
      })
    }

    emitAnchor('a')
    emitAnchor('b')
    emitAnchor('c')
    expect(save).toHaveBeenCalledTimes(1)
    resolveFirst?.()
    await waitFor(() => save.mock.calls.length === 2)
    expect(save.mock.calls[1][1].anchor.stableId).toBe('c')
    await waitFor(() => diagnostics.includes('anchorMemory.saveFailed'))
  })
})

function createAdapter(
  label: string,
  overrides: Partial<MessageListAdapter<TestRow, TestConversation>['request']> & {
    readReceipts?: MessageListAdapter<TestRow, TestConversation>['readReceipts']
    anchorMemory?: MessageListAdapter<TestRow, TestConversation>['anchorMemory']
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
    anchorMemory: overrides.anchorMemory,
  }
}

function page(
  ids: string[],
  options: Partial<Pick<
    MessageListPage<TestRow>,
    'hasMoreBefore' | 'hasMoreAfter' | 'reachedLatest'
  >> & {
    anchorId?: string
  } = {},
): MessageListPage<TestRow> {
  return {
    rows: ids.map((id) => ({ id })),
    hasMoreBefore: options.hasMoreBefore ?? false,
    hasMoreAfter: options.hasMoreAfter ?? false,
    reachedLatest: options.reachedLatest,
    anchor: options.anchorId
      ? { id: options.anchorId }
      : ids.at(-1) ? { id: ids.at(-1) } : undefined,
  }
}

function testDataItem(id: string): MessageDataItem<TestRow> {
  return {
    key: id,
    rowKind: 'message',
    renderVersion: 1,
    message: { id },
    identity: {
      sessionId: 'source-a',
      stableId: id,
      serverId: id,
      version: 1,
    },
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

function startSession(session: MessageListSession<TestRow>): void {
  getMessageListSessionInternals(session).retainView()
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

function observation(
  keys: string[],
  distanceToBottom = 0,
): ViewportObservationChangedEvent {
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
    distanceToBottom,
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
