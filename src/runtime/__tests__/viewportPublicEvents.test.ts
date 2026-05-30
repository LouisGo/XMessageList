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
  FakeScheduler,
  setElementMetrics,
} from '../../test/fakes'

describe('MessageList public runtime events', () => {
  it('reports visible ratio, range, source, direction, and activity', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      observers: createFakeObservers(),
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 60)
    const rowB = createRow('row-2', 60, 60)
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA, rowB)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', rowB)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    container.scrollTop = 35
    setElementMetrics(rowA, { top: -35, height: 60 })
    setElementMetrics(rowB, { top: 25, height: 60 })
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()

    const scrollObservation = events.find((event): event is Extract<
      MessageListRuntimeEvent,
      { type: 'viewportObservationChanged' }
    > =>
      event.type === 'viewportObservationChanged' &&
      event.reason === 'scroll-idle'
    )
    expect(scrollObservation).toMatchObject({
      feedId: 'feed-a',
      generation: 1,
      segmentRevision: 1,
      scrollSource: 'user',
      direction: 'down',
      activity: 'scrolling',
      visibleRange: { firstKey: 'row-1', lastKey: 'row-2' },
    })
    expect(scrollObservation?.visibleItems[0]?.visibleRatio)
      .toBeCloseTo(25 / 60, 5)
    expect(scrollObservation?.visibleItems[1]).toMatchObject({
      key: 'row-2',
      visibleRatio: 1,
    })
  })

  it('emits viewportReady once for each settled generation', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const events: MessageListRuntimeEvent[] = []

    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 2, {
      modifier: { type: 'patch', changedKeys: ['row-1'] },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.applyLoadedSegment(segment([item('row-2')], 2, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events.filter((event) => event.type === 'viewportReady'))
      .toEqual([
        expect.objectContaining({
          type: 'viewportReady',
          feedId: 'feed-a',
          commitToken: expect.objectContaining({ generation: 1 }),
        }),
        expect.objectContaining({
          type: 'viewportReady',
          feedId: 'feed-a',
          commitToken: expect.objectContaining({ generation: 2 }),
        }),
      ])
  })

  it('emits destinationSettled when an around jump resolves target', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 50)
    const rowB = createRow('row-2', 50, 50)
    const targetRow = createRow('row-3', 100, 50)
    const target = { feedId: 'feed-a', stableId: 'row-3', serverId: 'row-3' }
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToMessage(target, { align: 'end' })

    container.append(rowB, targetRow)
    adapter.registerRowElement('row-2', rowB)
    adapter.registerRowElement('row-3', targetRow)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2'), item('row-3')], 2, 1, {
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      intent: 'jump',
      target,
      resolution: 'target',
      resolvedTarget: expect.objectContaining({ stableId: 'row-3' }),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportObservationChanged',
      reason: 'transaction-settle',
      scrollSource: 'jump',
    }))
  })

  it('reports underflow fill as the transaction settle source', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 20)
    const rowB = createRow('row-0', -20, 20)
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    const request = events.find((event) => event.type === 'needMoreBefore')

    container.prepend(rowB)
    adapter.registerRowElement('row-0', rowB)
    runtime.applyLoadedSegment(segment([item('row-0'), item('row-1')], 1, 2, {
      hasMoreBefore: false,
      modifier: {
        type: 'extend-before',
        requestToken: request?.requestToken ?? '',
      },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportObservationChanged',
      segmentRevision: 2,
      reason: 'transaction-settle',
      scrollSource: 'underflowFill',
    }))
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
  overrides: Partial<LoadedSegment<string>> = {},
): LoadedSegment<string> {
  return {
    feedId: 'feed-a',
    generation,
    segmentRevision,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'bootstrap' },
    ...overrides,
  }
}

function createRow(key: string, top: number, height: number): HTMLDivElement {
  const row = document.createElement('div')
  row.dataset.runtimeKey = key
  row.dataset.messageStableId = key
  row.dataset.messageServerId = key
  row.dataset.rowKind = 'message'
  setElementMetrics(row, { top, height })
  return row
}
