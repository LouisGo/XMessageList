import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type MessageListRuntimeEvent,
} from '../index'
import {
  getMessageListAdapterRuntime,
  getMessageListSessionRegistryRuntime,
} from '../internal'
import {
  createContainer,
  createFakeObservers,
  FakeScheduler,
  setElementMetrics,
} from '../../../../test/fakes'

describe('MessageList public runtime events', () => {
  it('captures live row-local anchor memory and retains it without DOM', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const sessionRuntime = getMessageListSessionRegistryRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', -24, 60)

    container.append(row)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(sessionRuntime.getViewportAnchorMemory()).toEqual({
      anchor: expect.objectContaining({
        sessionId: 'source-a',
        stableId: 'row-1',
      }),
      offsetWithinMessage: 24,
    })

    runtime.detachScrollContainer()

    expect(sessionRuntime.getViewportAnchorMemory()).toEqual({
      anchor: expect.objectContaining({ stableId: 'row-1' }),
      offsetWithinMessage: 24,
    })
  })

  it('skips visible structural rows when resolving current and measured anchors', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const sessionRuntime = getMessageListSessionRegistryRuntime(runtime)
    const container = createContainer({ height: 100 })
    const dateRow = createRow('date-1', -10, 30)
    const messageRow = createRow('row-1', 20, 60)
    const events: MessageListRuntimeEvent[] = []

    dateRow.dataset.rowKind = 'date-separator'
    delete dateRow.dataset.messageStableId
    delete dateRow.dataset.messageServerId
    container.append(dateRow, messageRow)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('date-1', dateRow)
    adapter.registerRowElement('row-1', messageRow)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([
      {
        key: 'date-1',
        rowKind: 'date-separator',
        renderVersion: 1,
      },
      item('row-1'),
    ], 1, 1, { hasMoreAfter: true }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(sessionRuntime.getViewportAnchorMemory()).toEqual({
      anchor: expect.objectContaining({ stableId: 'row-1' }),
      offsetWithinMessage: 0,
    })

    events.length = 0
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()

    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportAnchorChanged',
      reason: 'scroll-idle',
      anchor: expect.objectContaining({ stableId: 'row-1' }),
      offsetWithinMessage: 0,
    }))
  })

  it('emits user navigation intent synchronously before scroll-frame observation', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', scheduler })
    const container = createContainer({ height: 100 })
    const events: MessageListRuntimeEvent[] = []

    runtime.attachScrollContainer(container)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([], 1, 1, { hasMoreAfter: true }))
    getMessageListAdapterRuntime(runtime)
      .ackProjectionCommit(runtime.getSnapshot().commitToken)
    events.length = 0

    container.dispatchEvent(new Event('wheel'))

    expect(events).toEqual([{
      type: 'viewportNavigationIntent',
      sessionId: 'source-a',
      generation: 1,
      segmentRevision: 1,
      reason: 'user-scroll',
    }])
    expect(events.some((event) =>
      event.type === 'viewportObservationChanged'
    )).toBe(false)
  })

  it('reports visible ratio, range, source, direction, and activity', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
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
      sessionId: 'source-a',
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
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
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
          sessionId: 'source-a',
          commitToken: expect.objectContaining({ generation: 1 }),
        }),
        expect.objectContaining({
          type: 'viewportReady',
          sessionId: 'source-a',
          commitToken: expect.objectContaining({ generation: 2 }),
        }),
      ])
  })

  it('emits one applied projectionSettled event per committed transaction', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const events: MessageListRuntimeEvent[] = []

    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    const token = runtime.getSnapshot().commitToken
    adapter.ackProjectionCommit(token)

    expect(events.filter((event) => event.type === 'projectionSettled')).toEqual([
      {
        type: 'projectionSettled',
        sessionId: 'source-a',
        generation: 1,
        segmentRevision: 1,
        commitToken: token,
        status: 'applied',
      },
    ])
  })

  it('emits destinationSettled when an around jump resolves target', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 50)
    const rowB = createRow('row-2', 50, 50)
    const targetRow = createRow('row-3', 100, 50)
    const target = { sessionId: 'source-a', stableId: 'row-3', serverId: 'row-3' }
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
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    scheduler.flushFrames(40)

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
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
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

  it('reports restore alignment as programmatic instead of jump source', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 50)
    const rowB = createRow('row-2', 50, 50)
    const targetRow = createRow('row-3', 100, 50)
    const target = { sessionId: 'source-a', stableId: 'row-3', serverId: 'row-3' }
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.restoreToMessage(target, { align: 'start' })

    container.append(rowB, targetRow)
    adapter.registerRowElement('row-2', rowB)
    adapter.registerRowElement('row-3', targetRow)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2'), item('row-3')], 2, 1, {
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    scheduler.flushFrame()

    expect(runtime.getDiagnostics().map((record) => record.name)).not.toContain('destinationMotion.start')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportObservationChanged',
      reason: 'transaction-settle',
      scrollSource: 'programmatic',
    }))
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'viewportObservationChanged',
      scrollSource: 'jump',
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

function createRow(key: string, top: number, height: number): HTMLDivElement {
  const row = document.createElement('div')
  row.dataset.runtimeKey = key
  row.dataset.messageStableId = key
  row.dataset.messageServerId = key
  row.dataset.rowKind = 'message'
  setElementMetrics(row, { top, height })
  return row
}
