import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type MessageListRuntimeEvent,
} from '../index'
import { getMessageListAdapterRuntime } from '../internal'
import {
  createContainer,
  createFakeObservers,
  setElementMetrics,
  FakeScheduler,
} from '../../../../test/fakes'

describe('MessageList viewport kernel', () => {
  it('waits for commit ack before measuring and correcting anchor', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 10, 40)

    container.scrollTop = 20
    container.append(row)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')
    expect(runtime.getDiagnostics().some((record) =>
      record.name === 'transaction.settle'
    )).toBe(false)

    setElementMetrics(row, { top: 30, height: 40 })
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(40)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'correction.anchorPreserved',
    )
  })

  it('drops stale generation segments', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })

    runtime.applyLoadedSegment(segment([item('row-2')], 2, 1))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 2))

    expect(runtime.getSnapshot().generation).toBe(2)
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'transaction.staleSegment',
    )
  })

  it('rejects loaded segments from another session', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const wrongSession = {
      ...segment([item('row-2')], 1, 1),
      sessionId: 'source-b',
    }

    runtime.applyLoadedSegment(wrongSession)

    expect(runtime.getSnapshot()).toMatchObject({
      sessionId: 'source-a',
      generation: 0,
      segmentRevision: 0,
    })
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'transaction.wrongSessionSegment',
      severity: 'error',
    }))
  })

  it('serializes projection transactions instead of replacing active work', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    const firstToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment([item('row-2')], 1, 2))

    expect(runtime.getSnapshot().segmentRevision).toBe(1)
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'transaction.queued',
    )

    adapter.ackProjectionCommit(firstToken)

    expect(runtime.getSnapshot().segmentRevision).toBe(2)
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics().filter((record) =>
      record.name === 'transaction.settle'
    )).toHaveLength(2)
  })

  it('defers post-commit underflow evaluation while a queued transaction starts', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 20)
    const rowB = createRow('row-2', 20, 20)
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
    }))
    const firstToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 2, {
      hasMoreBefore: true,
      hasMoreAfter: true,
    }))

    adapter.ackProjectionCommit(firstToken)

    expect(runtime.getSnapshot().segmentRevision).toBe(2)
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')
    expect(events.some((event) =>
      event.type === 'needMoreBefore' || event.type === 'needMoreAfter'
    )).toBe(false)

    container.append(rowB)
    adapter.registerRowElement('row-2', rowB)
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events.some((event) =>
      event.type === 'needMoreBefore' || event.type === 'needMoreAfter'
    )).toBe(true)
  })

  it('uses generation changes as the transaction cancellation boundary', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    const cancelledToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment([item('row-2')], 1, 2))
    runtime.applyLoadedSegment(segment([item('row-3')], 2, 1, {
      modifier: { type: 'reset-latest' },
    }))

    expect(runtime.getSnapshot()).toMatchObject({
      generation: 2,
      segmentRevision: 1,
      viewportPhase: 'PROJECTING',
    })

    adapter.ackProjectionCommit(cancelledToken)

    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'transaction.staleCommitAck',
    )
    expect(runtime.getSnapshot()).toMatchObject({
      generation: 2,
      segmentRevision: 1,
      viewportPhase: 'PROJECTING',
    })

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      generation: 2,
      segmentRevision: 1,
      viewportPhase: 'IDLE',
    })
    expect(runtime.getDiagnostics().filter((record) =>
      record.name === 'transaction.settle'
    )).toHaveLength(1)
  })

  it('keeps event-triggered segment publishes behind queued transactions', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    let publishedFromSettle = false

    runtime.subscribeRuntimeEvent((event) => {
      if (
        event.type === 'viewportAnchorChanged' &&
        event.reason === 'transaction-settle' &&
        !publishedFromSettle
      ) {
        publishedFromSettle = true
        runtime.applyLoadedSegment(segment([item('row-3')], 1, 3))
      }
    })

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    const firstToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment([item('row-2')], 1, 2))
    adapter.ackProjectionCommit(firstToken)

    expect(runtime.getSnapshot().segmentRevision).toBe(2)
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().segmentRevision).toBe(3)
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics().filter((record) =>
      record.name === 'transaction.settle'
    )).toHaveLength(3)
  })

  it('records commit timeout without publishing committed measurement', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
      commitTimeoutMs: 5,
    })
    const events: MessageListRuntimeEvent[] = []

    runtime.subscribeRuntimeEvent((event) => {
      events.push(event)
    })

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    scheduler.flushTimers()

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'transaction.commitTimeout',
    )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportError',
      code: 'commit-timeout',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'projectionSettled',
      commitToken: expect.objectContaining({ generation: 1, segmentRevision: 1 }),
      status: 'commit-timeout',
    }))
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: null,
      bottomLockState: 'UNLOCKED',
    })
  })

  it('keeps the reserved motion slot no-op for committed projections', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const phases: string[] = []

    runtime.subscribeSnapshot(() => { phases.push(runtime.getSnapshot().viewportPhase) })
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(phases).not.toContain('MOTION')
  })

  it('keeps stale timeout callbacks from clearing the current transaction', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
      commitTimeoutMs: 5,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const events: MessageListRuntimeEvent[] = []

    runtime.subscribeRuntimeEvent((event) => {
      events.push(event)
    })

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    runtime.applyLoadedSegment(segment([item('row-2')], 1, 2))
    scheduler.flushTimers()

    expect(runtime.getSnapshot().segmentRevision).toBe(2)
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')
    expect(runtime.getEvidence().commitToken.segmentRevision).toBe(2)
    expect(events.filter((event) =>
      event.type === 'viewportError' && event.code === 'commit-timeout'
    )).toHaveLength(1)

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics().filter((record) =>
      record.name === 'transaction.settle'
    )).toHaveLength(1)
  })

  it('reports evidence from the current loaded DOM segment', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 30)
    const rowB = createRow('row-2', 30, 50)

    container.append(rowA, rowB)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', rowB)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getEvidence()).toMatchObject({
      scrollHeight: 80,
      clientHeight: 100,
      visibleRows: [
        { key: 'row-1', top: 0, bottom: 30 },
        { key: 'row-2', top: 30, bottom: 80 },
      ],
    })
  })

  it('batches resize dirty measurement to the next frame', () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 0, 30)

    container.append(row)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)
    observers.resizeObservers[0]?.trigger(row, 60)

    expect(runtime.getDiagnostics().map((record) => record.name)).not.toContain(
      'measurement.resize.dirtyKeys',
    )

    scheduler.flushFrame()

    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'measurement.resize.dirtyKeys',
    )
  })

  it('observes container resize as an unknown full-measure dirty signal', () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 0, 30)

    container.append(row)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(observers.resizeObservers[0]?.observed.has(container)).toBe(true)

    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 140,
    })
    setElementMetrics(container, { top: 0, height: 140 })
    observers.resizeObservers[0]?.trigger(container, 140)
    scheduler.flushFrame()

    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'measurement.resize.dirtyKeys',
      details: expect.objectContaining({
        fallbackFullMeasure: true,
        reason: 'unknown',
      }),
    }))
  })

  it('resolves identity-remap anchors before correcting and publishing settle', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const previousRow = createRow('local-1', 10, 40)
    const nextRow = createRow('server-1', 30, 40)
    const events: MessageListRuntimeEvent[] = []

    container.scrollTop = 20
    container.append(previousRow)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('local-1', previousRow)
    runtime.subscribeRuntimeEvent((event) => {
      events.push(event)
    })

    runtime.applyLoadedSegment(segment([
      {
        key: 'server-1',
        rowKind: 'message',
        renderVersion: 2,
        message: 'server-1',
        identity: {
          sessionId: 'source-a',
          stableId: 'stable-1',
          serverId: 'server-1',
          version: 2,
        },
      },
    ], 1, 1, {
      modifier: {
        type: 'identity-remap',
        remaps: [
          {
            from: {
              sessionId: 'source-a',
              stableId: 'stable-1',
              localId: 'local-1',
            },
            to: {
              sessionId: 'source-a',
              stableId: 'stable-1',
              serverId: 'server-1',
            },
            previousKey: 'local-1',
            nextKey: 'server-1',
          },
        ],
      },
    }))

    previousRow.remove()
    container.append(nextRow)
    adapter.registerRowElement('local-1', null)
    adapter.registerRowElement('server-1', nextRow)
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(40)
    expect(runtime.getDiagnostics().map((record) => record.name)).not.toContain(
      'correction.anchorMissing',
    )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportAnchorChanged',
      reason: 'transaction-settle',
      anchor: expect.objectContaining({
        stableId: 'stable-1',
        serverId: 'server-1',
      }),
    }))
  })

  it('waits one frame for a committed anchor ref before correcting', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const previousRow = createRow('row-1', 10, 40)
    const nextRow = createRow('row-1', 30, 40)

    container.scrollTop = 20
    container.append(previousRow)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', previousRow)

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    previousRow.remove()
    adapter.registerRowElement('row-1', null)
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().viewportPhase).toBe('MEASURING')
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'correction.anchorAwaitingRef',
    )

    container.append(nextRow)
    adapter.registerRowElement('row-1', nextRow)
    scheduler.flushFrame()

    expect(container.scrollTop).toBe(40)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'correction.anchorPreserved',
    )
  })

  it('falls back to the nearest measurable row when the captured anchor is absent', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const previousRow = createRow('row-1', 10, 40)
    const fallbackRow = createRow('row-2', 35, 40)
    const events: MessageListRuntimeEvent[] = []

    container.scrollTop = 20
    container.append(previousRow)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', previousRow)
    runtime.subscribeRuntimeEvent((event) => events.push(event))

    runtime.applyLoadedSegment(segment([item('row-2')], 1, 1, {
      modifier: { type: 'trim-before', trimToken: 'trim:1' },
    }))
    previousRow.remove()
    container.append(fallbackRow)
    adapter.registerRowElement('row-1', null)
    adapter.registerRowElement('row-2', fallbackRow)
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(45)
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'correction.anchorFallback',
    )
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'viewportError',
      code: 'anchor-missing',
    }))
  })

  it('uses the declared surviving successor when the visual anchor is deleted', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', -50, 50)
    const deletedRow = createRow('row-2', 0, 50)
    const successorRow = createRow('row-3', 50, 50)

    container.scrollTop = 50
    container.append(rowA, deletedRow, successorRow)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', deletedRow)
    adapter.registerRowElement('row-3', successorRow)
    runtime.applyLoadedSegment(segment([
      item('row-1'),
      item('row-2'),
      item('row-3'),
    ], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.applyLoadedSegment(segment([item('row-1'), item('row-3')], 1, 2, {
      modifier: {
        type: 'remove',
        changedKeys: [],
        removedKeys: ['row-2'],
        removed: [{
          key: 'row-2',
          previousIndex: 1,
          successorKey: 'row-3',
          predecessorKey: 'row-1',
        }],
        firstAffectedIndex: 1,
      },
    }))
    deletedRow.remove()
    adapter.registerRowElement('row-2', null)
    setElementMetrics(successorRow, { top: 20, height: 50 })
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(70)
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'correction.deletedAnchorFallback',
      details: expect.objectContaining({
        removedKey: 'row-2',
        fallbackKey: 'row-3',
        strategy: 'successor',
      }),
    }))
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'measurement.cache.invalidate',
      details: expect.objectContaining({
        reason: 'remove-suffix',
        firstIndex: 1,
        inclusive: true,
      }),
    }))
    expect(runtime.getDiagnostics()).not.toContainEqual(expect.objectContaining({
      name: 'measurement.transaction.fullMeasure',
      details: expect.objectContaining({
        segmentRevision: 2,
        fullMeasureReason: 'anchor-missing-after-remap',
      }),
    }))
  })

  it('preserves the predecessor own geometry when deleting the final visual anchor', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const predecessorRow = createRow('row-1', -50, 50)
    const deletedRow = createRow('row-2', 0, 50)

    container.scrollTop = 50
    container.append(predecessorRow, deletedRow)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', predecessorRow)
    adapter.registerRowElement('row-2', deletedRow)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 2, {
      modifier: {
        type: 'remove',
        changedKeys: [],
        removedKeys: ['row-2'],
        removed: [{
          key: 'row-2',
          previousIndex: 1,
          predecessorKey: 'row-1',
        }],
        firstAffectedIndex: 1,
      },
    }))
    deletedRow.remove()
    adapter.registerRowElement('row-2', null)
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(50)
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'correction.anchorPreserved',
      details: expect.objectContaining({ key: 'row-1', delta: 0 }),
    }))
  })

  it('settles an empty deletion with a null anchor and no missing-anchor recovery', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const deletedRow = createRow('row-1', 0, 50)
    const events: MessageListRuntimeEvent[] = []

    container.append(deletedRow)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', deletedRow)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.applyLoadedSegment(segment([], 1, 2, {
      modifier: {
        type: 'remove',
        changedKeys: [],
        removedKeys: ['row-1'],
        removed: [{ key: 'row-1', previousIndex: 0 }],
        firstAffectedIndex: 0,
      },
    }))
    deletedRow.remove()
    adapter.registerRowElement('row-1', null)
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportAnchorChanged',
      reason: 'transaction-settle',
      anchor: null,
    }))
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'viewportError',
      code: 'anchor-missing',
    }))
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'measurement.rectRead.count',
      details: expect.objectContaining({
        source: 'transaction-precheck',
        segmentRevision: 2,
        fallbackFullMeasure: false,
        rowCount: 0,
      }),
    }))
  })

  it('emits viewport anchor checkpoints on settle and detach', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 30)
    const rowB = createRow('row-2', 30, 30)
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA, rowB)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', rowB)
    runtime.subscribeRuntimeEvent((event) => {
      events.push(event)
    })

    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    setElementMetrics(rowA, { top: -40, height: 30 })
    setElementMetrics(rowB, { top: 0, height: 30 })
    runtime.detachScrollContainer()

    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportAnchorChanged',
      reason: 'transaction-settle',
      anchor: expect.objectContaining({ stableId: 'row-1' }),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportAnchorChanged',
      reason: 'detach',
      anchor: expect.objectContaining({ stableId: 'row-2' }),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportObservationChanged',
      visibleKeys: ['row-1', 'row-2'],
    }))
  })

  it('clears all DOM refs and unobserves rows on detach', () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 0, 30)
    const flow = createMarker(0, 30)
    const before = createMarker(0, 1)
    const after = createMarker(30, 1)
    const bottom = createMarker(31, 1)

    container.append(row)
    runtime.attachScrollContainer(container)
    adapter.registerMessageFlowElement(flow)
    adapter.registerBeforeTriggerElement(before)
    adapter.registerAfterTriggerElement(after)
    adapter.registerBottomMarkerElement(bottom)
    adapter.registerRowElement('row-1', row)

    expect(observers.resizeObservers[0]?.observed.has(container)).toBe(true)
    expect(observers.resizeObservers[0]?.observed.has(row)).toBe(true)

    runtime.detachScrollContainer()
    adapter.registerRowElement('row-1', null)

    expect(observers.resizeObservers[0]?.observed.has(container)).toBe(false)
    expect(observers.resizeObservers[0]?.observed.has(row)).toBe(false)

    runtime.applyLoadedSegment(segment([item('row-2')], 2, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getEvidence()).toMatchObject({
      visibleRows: [],
      beforeTrigger: { top: 0, bottom: 0, height: 0 },
      afterTrigger: { top: 0, bottom: 0, height: 0 },
      bottomMarker: null,
    })
  })

  it('keeps destroy idempotent and rejects later attach or segment work', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
    })
    const container = createContainer({ height: 100 })
    const initialSnapshot = runtime.getSnapshot()

    runtime.destroy()
    runtime.destroy()
    runtime.attachScrollContainer(container)
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    scheduler.flushTimers()

    expect(runtime.getSnapshot()).toBe(initialSnapshot)
    expect(runtime.getEvidence()).toMatchObject({
      sessionId: 'source-a',
      generation: 0,
      segmentRevision: 0,
      visibleRows: [],
    })
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'runtime.destroyedOperation',
        details: { operation: 'attachScrollContainer' },
      }),
      expect.objectContaining({
        name: 'runtime.destroyedOperation',
        details: { operation: 'applyLoadedSegment' },
      }),
    ]))
  })
})

function item(key: string): MessageDataItem<string> {
  return {
    key,
    rowKind: 'message',
    renderVersion: 1,
    message: key,
    identity: {
      sessionId: 'source-a',
      stableId: key,
      serverId: key,
      version: 1,
    },
  }
}

function segment(
  items: MessageDataItem<string>[],
  generation: number,
  segmentRevision: number,
  overrides: Partial<LoadedSegment<string>> = {},
): LoadedSegment<string> {
  return {
    sessionId: 'source-a',
    generation,
    segmentRevision,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'bootstrap' },
    ...overrides,
    context: overrides.context ?? 'latest',
  }
}

function createRow(
  key: string,
  top: number,
  height: number,
): HTMLDivElement {
  const row = document.createElement('div')
  row.dataset.runtimeKey = key
  row.dataset.rowKind = 'message'
  row.dataset.messageStableId = key
  setElementMetrics(row, { top, height })
  return row
}

function createMarker(top: number, height: number): HTMLDivElement {
  const marker = document.createElement('div')
  setElementMetrics(marker, { top, height })
  return marker
}
