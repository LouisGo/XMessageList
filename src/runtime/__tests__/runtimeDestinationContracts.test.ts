import { describe, expect, it } from 'vitest'
import {
  createContainer,
  createRuntime,
  createSnapshot,
  flushBootstrap,
  mountProjection,
} from './runtimeTestUtils'
import type { MessageViewportRuntimeEvent } from '..'

describe('MessageViewportRuntime destination contracts', () => {
  it('restores by synchronous anchor correction without starting motion', async () => {
    const { runtime, scheduler } = createRuntime({
      debug: {
        diagnostics: {
          channels: ['motion'],
          emitEvents: false,
          maxEntries: 100,
        },
      },
    })
    const container = createContainer({ height: 300 })

    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 40, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)

    runtime.dispatch({
      type: 'restore',
      target: {
        key: { kind: 'committed', messageId: 'm-10' },
        offsetWithinMessage: 24,
      },
    })
    await Promise.resolve()

    const snapshot = runtime.getSnapshot()
    expect(runtime.getDebugSnapshot().destinationState).toBe('resolvingDom')
    expect(runtime.getDebugSnapshot().motionActive).toBe(false)

    mountProjection(runtime, container, snapshot, -container.scrollTop)
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().destinationState).toBe('settled')
    expect(runtime.getDebugSnapshot().motionActive).toBe(false)
    expect(
      runtime
        .getDiagnosticRecords()
        .some((record) => record.name === 'destinationMotion.start'),
    ).toBe(false)
  })

  it('does not consume pending restore from a non-reset snapshot containing the target', async () => {
    const { runtime, scheduler } = createRuntime()
    const container = createContainer({ height: 300 })
    const events: MessageViewportRuntimeEvent[] = []

    runtime.subscribeEvent((event) => {
      events.push(event)
    })
    runtime.attach(container)
    runtime.setDataSnapshot(createSnapshot({ count: 30, revision: 1, effect: 'reset' }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    await Promise.resolve()
    await flushBootstrap(runtime, scheduler, container)
    events.length = 0

    runtime.dispatch({
      type: 'restore',
      target: {
        key: { kind: 'committed', messageId: 'm-100' },
        offsetWithinMessage: 12,
      },
    })
    await Promise.resolve()

    const beforeRevision = runtime.getSnapshot().revision

    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 2,
      effect: 'items-change',
      kind: 'patch',
      start: 86,
    }))
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().readySubstate).toBe(
      'READY_DESTINATION_PENDING',
    )
    expect(runtime.getDebugSnapshot().destinationState).toBe('pendingData')
    expect(runtime.getSnapshot().revision).toBe(beforeRevision)
    expect(
      events.filter((event) =>
        event.type === 'needMessagesAround' && event.reason === 'restore'
      ),
    ).toHaveLength(2)

    runtime.setDataSnapshot(createSnapshot({
      count: 30,
      revision: 3,
      effect: 'reset',
      kind: 'reset',
      start: 86,
      anchor: { messageId: 'm-100', position: 100 },
    }))
    await Promise.resolve()

    expect(runtime.getDebugSnapshot().destinationState).toBe('resolvingDom')
    expect(runtime.getSnapshot().items.some((item) =>
      item.key.kind === 'committed' && item.key.messageId === 'm-100'
    )).toBe(true)
  })
})
