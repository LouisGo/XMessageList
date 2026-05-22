import { describe, expect, it } from 'vitest'
import {
  commitCurrentProjection,
  createContainer,
  createSnapshot,
  createRuntime,
  flushBootstrap,
  getExpectedRestoreScrollTop,
  mountProjection,
} from './runtimeTestUtils'
import type { TestMessage } from './runtimeTestUtils'
import type {
  MessageDataSnapshot,
  MessageDataSnapshotChange,
  MessageViewportRuntimeEvent,
} from '..'

describe('MessageViewportRuntime reserved viewport modifiers', () => {
  it('preserves the current visual anchor for anchor-risk mutations', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({ count: 10, revision: 1, effect: 'reset' }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    container.scrollTop = 100

    runtime.setDataSnapshot({
      ...createSnapshot({ count: 10, revision: 2, effect: 'items-change' }),
      change: {
        kind: 'patch',
        viewportModifier: 'anchor-risk',
      },
    })
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, 40)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBe(140)
    expect(events).not.toContainEqual(
      expect.objectContaining({ code: expect.stringContaining('not-implemented') }),
    )
  })

  it('preserves the current visual anchor when older items are removed from the start', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({ count: 20, revision: 1, effect: 'reset' }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    container.scrollTop = 300
    mountProjection(runtime, container, runtime.getSnapshot(), -300)

    runtime.setDataSnapshot(
      createSnapshot({
        count: 15,
        revision: 2,
        effect: 'remove-from-start',
        start: 6,
      }),
    )
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, 30)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBe(380)
  })

  it('aligns item-location snapshots to the provided identity anchor', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({ count: 30, revision: 1, effect: 'reset' }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.setDataSnapshot(
      createSnapshot({
        count: 30,
        revision: 2,
        effect: 'item-location',
        anchor: { messageId: 'm-10' },
      }),
    )
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()
    mountProjection(runtime, container, snapshot, -container.scrollTop)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBe(
      getExpectedRestoreScrollTop(snapshot, 'm-10', 0),
    )
  })

  it('requires explicit identity remaps and preserves the remapped row position', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []
    const optimisticKey = {
      kind: 'optimistic' as const,
      clientMessageId: 'client-1',
    }
    const committedKey = {
      kind: 'committed' as const,
      messageId: 'm-1',
    }
    const initial: MessageDataSnapshot<TestMessage> = {
      feedId: 'feed',
      generation: 1,
      revision: 1,
      items: [
        {
          kind: 'optimistic',
          key: optimisticKey,
          draft: { id: 'client-1', text: 'sending' },
          status: 'sending',
          version: 1,
          contentVersion: 1,
          estimatedHeight: 50,
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
      change: {
        kind: 'initial',
        viewportModifier: 'reset',
      },
    }

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(initial)
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.setDataSnapshot({
      ...initial,
      revision: 2,
      items: [
        {
          kind: 'committed',
          key: committedKey,
          message: { id: 'm-1', text: 'sent' },
          version: 1,
          contentVersion: 1,
          estimatedHeight: 50,
        },
      ],
      anchor: { messageId: 'm-1' },
      anchorStatus: 'normal',
      change: {
        kind: 'identityRebind',
        viewportModifier: 'identity-remap',
        identityRemaps: [
          {
            from: optimisticKey,
            to: committedKey,
          },
        ],
      },
    })
    await Promise.resolve()
    const snapshot = runtime.getSnapshot()

    expect(snapshot.items[0]?.key).toEqual(committedKey)

    mountProjection(runtime, container, snapshot, 42)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.scrollTop).toBe(42)
    expect(events).not.toContainEqual(
      expect.objectContaining({ code: expect.stringContaining('not-implemented') }),
    )
  })

  it('does not infer identity-remap without an explicit remap payload', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []
    const optimisticKey = {
      kind: 'optimistic' as const,
      clientMessageId: 'client-1',
    }

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot({
      feedId: 'feed',
      generation: 1,
      revision: 1,
      items: [
        {
          kind: 'optimistic',
          key: optimisticKey,
          draft: { id: 'client-1', text: 'sending' },
          status: 'sending',
          version: 1,
          estimatedHeight: 50,
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
      change: {
        kind: 'initial',
        viewportModifier: 'reset',
      },
    })
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.setDataSnapshot({
      feedId: 'feed',
      generation: 1,
      revision: 2,
      items: [
        {
          kind: 'committed',
          key: { kind: 'committed', messageId: 'm-1' },
          message: { id: 'm-1', text: 'sent' },
          version: 1,
          estimatedHeight: 50,
        },
      ],
      anchor: { messageId: 'm-1' },
      anchorStatus: 'normal',
      hasMoreBefore: false,
      hasMoreAfter: false,
      change: {
        kind: 'identityRebind',
        viewportModifier: 'identity-remap',
      } as MessageDataSnapshotChange,
    })
    await Promise.resolve()

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'viewportError',
        code: 'viewport-modifier-identity-remap-remaps-missing',
      }),
    )
  })

  it('skips a queued reserved modifier when a newer snapshot supersedes its revision', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['transaction'],
          emitEvents: false,
          maxEntries: 100,
        },
      },
    })
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []
    const optimisticKey = {
      kind: 'optimistic' as const,
      clientMessageId: 'client-queued',
    }
    const committedKey = {
      kind: 'committed' as const,
      messageId: 'm-queued',
    }

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({ count: 30, revision: 1, effect: 'reset' }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.setDataSnapshot(createSnapshot({ count: 31, revision: 2, effect: 'append' }))
    await Promise.resolve()

    runtime.setDataSnapshot({
      ...createSnapshot({ count: 31, revision: 3, effect: 'items-change' }),
      change: {
        kind: 'identityRebind',
        viewportModifier: 'identity-remap',
        identityRemaps: [
          {
            from: optimisticKey,
            to: committedKey,
          },
        ],
      },
    })
    runtime.setDataSnapshot(createSnapshot({ count: 32, revision: 4, effect: 'items-change' }))

    await commitCurrentProjection(runtime, container)
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)

    expect(runtime.getSnapshot().items.at(-1)?.key).toEqual({
      kind: 'committed',
      messageId: 'm-32',
    })
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'viewportError',
        code: 'viewport-modifier-identity-remap-remaps-missing',
      }),
    )
    expect(runtime.getDiagnosticRecords()).toContainEqual(
      expect.objectContaining({
        name: 'transaction.skipStaleDataSnapshot',
        details: expect.objectContaining({
          expected: expect.objectContaining({ revision: 3 }),
          current: expect.objectContaining({ revision: 4 }),
        }),
      }),
    )
  })

  it('bootstraps current data when a queued reset snapshot is superseded', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['transaction'],
          emitEvents: false,
          maxEntries: 100,
        },
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({ count: 80, revision: 1, effect: 'reset' }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.setDataSnapshot(
      createSnapshot({ count: 81, revision: 2, effect: 'append' }),
    )
    await Promise.resolve()
    runtime.setDataSnapshot(
      createSnapshot({ count: 30, revision: 3, effect: 'reset' }),
    )
    runtime.setDataSnapshot(
      createSnapshot({ count: 31, revision: 4, effect: 'items-change' }),
    )

    await commitCurrentProjection(runtime, container)
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    const snapshot = runtime.getSnapshot()
    const records = runtime.getDiagnosticRecords()

    expect(snapshot.renderWindow).toEqual(
      expect.objectContaining({
        startIndex: 11,
        endIndex: 30,
      }),
    )
    expect(snapshot.items).toHaveLength(20)
    expect(snapshot.items[0]?.key).toEqual({
      kind: 'committed',
      messageId: 'm-12',
    })
    expect(snapshot.items.at(-1)?.key).toEqual({
      kind: 'committed',
      messageId: 'm-31',
    })
    expect(records).toContainEqual(
      expect.objectContaining({
        name: 'transaction.resetSnapshotSuperseded',
        details: expect.objectContaining({
          expected: expect.objectContaining({ revision: 3 }),
          current: expect.objectContaining({ revision: 4 }),
        }),
      }),
    )
    expect(records).toContainEqual(
      expect.objectContaining({
        name: 'transaction.drop',
        details: expect.objectContaining({
          kind: 'resize',
          reason: 'key-supersede',
        }),
      }),
    )
  })

  it('drops a queued generic data refresh when a reserved modifier arrives', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['transaction'],
          emitEvents: false,
          maxEntries: 100,
        },
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(
      createSnapshot({ count: 30, revision: 1, effect: 'reset' }),
    )
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.setDataSnapshot(createSnapshot({ count: 31, revision: 2, effect: 'append' }))
    await Promise.resolve()
    runtime.setDataSnapshot(createSnapshot({ count: 32, revision: 3, effect: 'items-change' }))
    runtime.setDataSnapshot(
      createSnapshot({ count: 28, revision: 4, effect: 'anchor-risk' }),
    )

    await commitCurrentProjection(runtime, container)
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)
    await Promise.resolve()
    await commitCurrentProjection(runtime, container)

    const records = runtime.getDiagnosticRecords()

    expect(records).toContainEqual(
      expect.objectContaining({
        name: 'transaction.drop',
        details: expect.objectContaining({
          kind: 'resize',
          reason: 'key-supersede',
        }),
      }),
    )
    expect(records).toContainEqual(
      expect.objectContaining({
        name: 'transaction.start',
        details: expect.objectContaining({
          kind: 'anchorRisk',
        }),
      }),
    )
    expect(
      records.some(
        (record) =>
          record.name === 'transaction.start' &&
          record.details.kind === 'resize',
      ),
    ).toBe(false)
  })
})
