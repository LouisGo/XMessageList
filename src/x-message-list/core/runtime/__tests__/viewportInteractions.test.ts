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
describe('MessageList viewport interactions', () => {
  it('latches edge paging, reports errors, and retries through runtime state', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const before = createMarker(0, 1)
    const row = createRow('row-1', 1, 180)
    const events: MessageListRuntimeEvent[] = []
    container.append(before, row)
    runtime.attachScrollContainer(container)
    adapter.registerBeforeTriggerElement(before)
    adapter.registerRowElement('row-1', row)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.dispatchEvent(new Event('scroll'))
    observers.intersectionObservers[0]?.trigger(before, true)
    observers.intersectionObservers[0]?.trigger(before, true)
    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(1)
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: 'edge-before',
      edgeState: { before: { status: 'loading', requestToken: expect.any(String) } },
    })
    const requestToken = runtime.getSnapshot().edgeState.before.requestToken as string
    runtime.reportEdgeRequestFailure('before', requestToken)
    expect(runtime.getSnapshot().edgeState.before.status).toBe('error')
    adapter.retryEdgeRequest('before')
    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(2)
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: 'edge-before',
      edgeState: { before: { status: 'loading' } },
    })
  })
  it('treats direct scrollbar writes as edge-capable user input', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 0, 180)
    const after = createMarker(180, 1)
    const events: MessageListRuntimeEvent[] = []
    container.append(row, after)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)
    adapter.registerAfterTriggerElement(after)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    adapter.beginDirectScroll()
    expect(adapter.writeDirectScrollTop(20)).toBe(true)
    container.dispatchEvent(new Event('scroll'))
    observers.intersectionObservers[0]?.trigger(after, true)
    adapter.endDirectScroll()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMoreAfter',
      reason: 'near-after',
    }))
    const request = events.find((event) =>
      event.type === 'needMoreAfter'
    )
    const row2 = createRow('row-2', 180, 80)
    container.insertBefore(row2, after)
    adapter.registerRowElement('row-2', row2)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 2, {
      hasMoreAfter: false,
      modifier: {
        type: 'extend-after',
        requestToken: request?.requestToken ?? '',
      },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot().pendingIntent).toBeNull()
  })
  it('keeps long direct scrollbar drags edge-capable until end', () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 0, 180)
    const after = createMarker(180, 1)
    const events: MessageListRuntimeEvent[] = []
    container.append(row, after)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)
    adapter.registerAfterTriggerElement(after)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    adapter.beginDirectScroll()
    expect(adapter.writeDirectScrollTop(20)).toBe(true)
    scheduler.flushFrames(20)
    observers.intersectionObservers[0]?.trigger(after, true)
    adapter.endDirectScroll()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMoreAfter',
      reason: 'near-after',
    }))
  })
  it('updates evidence, observation, and scroll-idle anchor on ordinary scroll', () => {
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
    expect(runtime.getEvidence().scrollTop).toBe(0)
    scheduler.flushFrame()
    expect(runtime.getEvidence().scrollTop).toBe(35)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportObservationChanged',
      visibleKeys: ['row-1', 'row-2'],
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportAnchorChanged',
      reason: 'scroll-idle',
      anchor: expect.objectContaining({ stableId: 'row-1' }),
    }))
  })
  it('bounds ordinary scroll row rect reads to cached visible samples', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      observers: createFakeObservers(),
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rectReads = { count: 0 }
    const rows = Array.from({ length: 80 }, (_, index) =>
      createCountingRow(`row-${index + 1}`, index * 20, 20, rectReads),
    )
    container.append(...rows)
    runtime.attachScrollContainer(container)
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(
      rows.map((row) => item(row.dataset.runtimeKey as string)),
      1,
      1,
    ))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    rectReads.count = 0
    container.scrollTop = 200
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()
    expect(rectReads.count).toBeLessThan(80)
    expect(rectReads.count).toBeLessThanOrEqual(32)
    expect(runtime.getEvidence().scrollTop).toBe(200)
  })
  it('refreshes evidence after local programmatic scroll writes', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      observers: createFakeObservers(),
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = [
      createRow('row-1', 0, 50),
      createRow('row-2', 50, 50),
      createRow('row-3', 100, 50),
    ]
    container.append(...rows)
    runtime.attachScrollContainer(container)
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(rows.map((row) =>
      item(row.dataset.runtimeKey as string)
    ), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToLatest()
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    expect(container.scrollTop).toBe(0)
    expect(runtime.getEvidence().scrollTop).toBe(0)
    scheduler.flushFrames(40)
    expect(runtime.getEvidence().scrollTop).toBe(50)
  })
  it('arbitrates short segment underflow to a single edge request', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 0, 20)
    const events: MessageListRuntimeEvent[] = []
    container.append(row)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(events.filter((event) =>
      event.type === 'needMoreBefore' || event.type === 'needMoreAfter'
    )).toHaveLength(1)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMoreBefore',
      reason: 'underflow-fill',
    }))
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: 'underflow-fill',
      segmentMeta: { underflow: 'fillable' },
    })
  })
  it('continues underflow fill until the native range clears the edge margin', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 20)
    const rowB = createRow('row-0', -110, 110)
    const events: MessageListRuntimeEvent[] = []
    container.append(rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
      hasMoreAfter: false,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    const firstRequest = events.find((event) => event.type === 'needMoreBefore')
    container.prepend(rowB)
    adapter.registerRowElement('row-0', rowB)
    runtime.applyLoadedSegment(segment([item('row-0'), item('row-1')], 1, 2, {
      hasMoreBefore: true,
      hasMoreAfter: false,
      modifier: { type: 'extend-before', requestToken: firstRequest?.requestToken ?? '' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getEvidence().scrollHeight).toBe(130)
    expect(events.filter((event) =>
      event.type === 'needMoreBefore' &&
      event.reason === 'underflow-fill'
    )).toHaveLength(2)
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: 'underflow-fill',
      segmentMeta: { underflow: 'fillable' },
    })
  })
  it('does not start underflow from edge margin alone', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 60)
    const rowB = createRow('row-2', 60, 70)
    const events: MessageListRuntimeEvent[] = []
    container.append(rowA, rowB)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', rowB)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 1, {
      hasMoreBefore: true,
      hasMoreAfter: false,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getEvidence().scrollHeight).toBe(130)
    expect(events.some((event) =>
      event.type === 'needMoreBefore' || event.type === 'needMoreAfter'
    )).toBe(false)
  })
  it('uses reset-around anchor protection to choose the thin underflow side', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 20)
    const rowB = createRow('row-2', 20, 20)
    const rowC = createRow('row-3', 40, 20)
    const target = { feedId: 'feed-a', stableId: 'row-3', serverId: 'row-3' }
    const events: MessageListRuntimeEvent[] = []
    container.append(rowA, rowB, rowC)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', rowB)
    adapter.registerRowElement('row-3', rowC)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2'), item('row-3')], 1, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMoreAfter',
      reason: 'underflow-fill',
    }))
    expect(events.some((event) => event.type === 'needMoreBefore')).toBe(false)
  })
  it('alternates middle underflow fills across anchor sides', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
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
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    const beforeEvent = events.find((event) => event.type === 'needMoreBefore')
    expect(beforeEvent).toEqual(expect.objectContaining({
      type: 'needMoreBefore',
      reason: 'underflow-fill',
    }))
    container.prepend(rowB)
    adapter.registerRowElement('row-2', rowB)
    runtime.applyLoadedSegment(segment([item('row-2'), item('row-1')], 1, 2, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: {
        type: 'extend-before',
        requestToken: beforeEvent?.requestToken ?? '',
      },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMoreAfter',
      reason: 'underflow-fill',
    }))
  })
  it('follows latest via reset and locks bottom only at feed latest', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 50)
    const rowB = createRow('row-2', 50, 50)
    const rowC = createRow('row-3', 100, 50)
    const events: MessageListRuntimeEvent[] = []
    container.append(rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToLatest()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needLatestMessages',
      reason: 'bottom-follow',
    }))
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: 'follow-bottom',
      bottomLockState: 'UNLOCKED',
    })
    container.append(rowB, rowC)
    adapter.registerRowElement('row-2', rowB)
    adapter.registerRowElement('row-3', rowC)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2'), item('row-3')], 2, 1, {
      hasMoreAfter: false,
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: null,
      bottomLockState: 'UNLOCKED',
    })
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    scheduler.flushFrames(40)
    expect(container.scrollTop).toBe(50)
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
  })
  it('stabilizes dynamic height changes above the visual anchor', () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', -40, 30)
    const rowB = createRow('row-2', 0, 30)
    container.scrollTop = 40
    container.append(rowA, rowB)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', rowB)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    setElementMetrics(rowA, { top: -60, height: 50 })
    setElementMetrics(rowB, { top: 20, height: 30 })
    observers.resizeObservers[0]?.trigger(rowA, 50)
    scheduler.flushFrame()
    expect(container.scrollTop).toBe(60)
    expect(runtime.getDiagnostics().map((record) => record.name)).toContain(
      'measurement.resizeDirty',
    )
  })
  it('records measurement cache, blank area, frame gap, and latency diagnostics', () => {
    const scheduler = new FakeScheduler()
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 0, 80)
    container.append(row)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    setElementMetrics(row, { top: 0, height: 90 })
    observers.resizeObservers[0]?.trigger(row, 90)
    scheduler.flushFrame()
    const diagnostics = runtime.getDiagnostics()
    const names = diagnostics.map((record) => record.name)
    expect(names).toEqual(expect.arrayContaining([
      'transaction.settle',
      'measurement.cache.miss',
      'measurement.cache.hit',
      'blank-area.sample',
      'frame-gap.sample',
    ]))
    expect(diagnostics.find((record) => record.name === 'transaction.settle'))
      .toMatchObject({ details: { latencyMs: expect.any(Number) } })
  })
  it('requests around messages for outside destination and aligns reset target', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
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
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMessagesAround',
      reason: 'jump',
      target,
    }))
    expect(runtime.getSnapshot().pendingIntent).toBe('destination')
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
    expect(container.scrollTop).toBe(50)
    expect(runtime.getSnapshot().pendingIntent).toBeNull()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'viewportAnchorChanged',
      reason: 'transaction-settle',
      anchor: expect.objectContaining({ stableId: 'row-3' }),
    }))
  })
  it('restores visible targets with local align before requesting around', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 50)
    const rowB = createRow('row-2', 50, 50)
    const rowC = createRow('row-3', 100, 50)
    const target = { feedId: 'feed-a', stableId: 'row-3', serverId: 'row-3' }
    const events: MessageListRuntimeEvent[] = []
    container.append(rowA, rowB, rowC)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', rowB)
    adapter.registerRowElement('row-3', rowC)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(
      segment([item('row-1'), item('row-2'), item('row-3')], 1, 1),
    )
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.restoreToMessage(target, { align: 'end' })
    expect(events.some((event) => event.type === 'needMessagesAround')).toBe(false)
    expect(container.scrollTop).toBe(50)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getSnapshot().pendingIntent).toBeNull()
    expect(runtime.getDiagnostics().map((record) => record.name)).not.toContain('destinationMotion.start')
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
function createCountingRow(
  key: string,
  top: number,
  height: number,
  rectReads: { count: number },
): HTMLDivElement {
  const row = createRow(key, top, height)
  const readRect = row.getBoundingClientRect
  row.getBoundingClientRect = () => {
    rectReads.count += 1
    return readRect()
  }
  return row
}
