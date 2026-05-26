import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
} from '../index'
import { getMessageListAdapterRuntime } from '../internal'
import {
  createContainer,
  createFakeObservers,
  setElementMetrics,
  FakeScheduler,
} from '../../test/fakes'

describe('MessageList viewport kernel', () => {
  it('waits for commit ack before measuring and correcting anchor', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
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
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })

    runtime.applyLoadedSegment(segment([item('row-2')], 2, 1))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 2))

    expect(runtime.getSnapshot().generation).toBe(2)
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'transaction.staleSegment',
    )
  })

  it('records commit timeout without publishing committed measurement', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      commitTimeoutMs: 5,
    })

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    scheduler.flushTimers()

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'transaction.commitTimeout',
    )
  })

  it('reports evidence from the current loaded DOM segment', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
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
      feedId: 'feed-a',
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
      'measurement.resizeDirty',
    )

    scheduler.flushFrame()

    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'measurement.resizeDirty',
    )
  })
})

function item(key: string): MessageDataItem<string> {
  return {
    key,
    rowKind: 'message',
    renderVersion: 1,
    message: key,
    identity: {
      feedId: 'feed-a',
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
): LoadedSegment<string> {
  return {
    feedId: 'feed-a',
    generation,
    segmentRevision,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'bootstrap' },
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
