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
} from '../../../../test/fakes'

describe('MessageList destination state', () => {
  it('clears stale edge latches when a destination reset rebuilds the segment', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const before = createMarker(0, 1)
    const rowA = createRow('row-1', 1, 50)
    const targetRow = createRow('row-9', 51, 200)
    const target = { sessionId: 'source-a', stableId: 'row-9', serverId: 'row-9' }
    const events: MessageListRuntimeEvent[] = []

    container.append(before, rowA, targetRow)
    runtime.attachScrollContainer(container)
    adapter.registerBeforeTriggerElement(before)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    container.dispatchEvent(new Event('scroll'))
    observers.intersectionObservers[0]?.trigger(before, true)
    const staleBeforeRequest = events.find((event) =>
      event.type === 'needMoreBefore'
    )
    expect(staleBeforeRequest).toEqual(expect.objectContaining({
      type: 'needMoreBefore',
    }))

    runtime.scrollToMessage(target, { align: 'center' })
    adapter.registerRowElement('row-9', targetRow)
    runtime.applyLoadedSegment(segment([item('row-9')], 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().edgeState.before.status).toBe('idle')
    runtime.reportEdgeRequestFailure(
      'before',
      staleBeforeRequest?.requestToken ?? '',
    )
    expect(runtime.getSnapshot().edgeState.before.status).toBe('idle')

    adapter.beginDirectScroll()
    expect(adapter.writeDirectScrollTop(0)).toBe(true)
    observers.intersectionObservers[0]?.trigger(before, true)
    adapter.endDirectScroll()

    expect(events.filter((event) => event.type === 'needMoreBefore'))
      .toHaveLength(2)
  })

  it('clears follow-bottom intent when a local destination jump aligns in place', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
      observers: createFakeObservers(),
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 6 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50)
    )
    const items = rows.map((row) => item(row.dataset.runtimeKey as string))
    const target = { sessionId: 'source-a', stableId: 'row-1', serverId: 'row-1' }

    container.append(...rows)
    runtime.attachScrollContainer(container)
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(items, 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToLatest()
    scheduler.flushFrames(40)
    expect(container.scrollTop).toBe(200)

    rows.forEach((row, index) => setElementMetrics(row, {
      top: index * 50 - 200,
      height: 50,
    }))
    runtime.scrollToMessage(target, { align: 'start' })
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    scheduler.flushFrames(40)
    expect(container.scrollTop).toBe(0)

    rows.forEach((row, index) => setElementMetrics(row, {
      top: index * 50,
      height: 50,
    }))
    runtime.applyLoadedSegment(segment(items, 1, 2, {
      modifier: { type: 'patch', changedKeys: ['row-3'] },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(0)
  })

  it('lets user input cancel pending destination data and rejects its late around segment', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const row = createRow('row-1', 0, 50)
    const target = { sessionId: 'source-a', stableId: 'row-9', serverId: 'row-9' }
    const events: MessageListRuntimeEvent[] = []

    container.append(row)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', row)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.scrollToMessage(target)
    const around = events.find((event) => event.type === 'needMessagesAround')
    expect(runtime.getSnapshot().pendingIntent).toBe('destination')

    container.dispatchEvent(new Event('wheel'))

    expect(runtime.getSnapshot().pendingIntent).toBeNull()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationCancelled',
      requestToken: around && 'requestToken' in around ? around.requestToken : undefined,
      reason: 'user-interrupt',
    }))

    runtime.applyLoadedSegment(segment([item('row-9')], 2, 1, {
      modifier: {
        type: 'reset-around',
        target,
        requestToken: around && 'requestToken' in around ? around.requestToken : undefined,
      },
      anchor: target,
    }))

    expect(runtime.getSnapshot()).toMatchObject({
      generation: 1,
      segmentRevision: 1,
      items: [expect.objectContaining({ key: 'row-1' })],
    })
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destination.staleSegment',
    }))
  })

  it('reopens an exhausted edge when budget trim removes that edge', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 60)
    const rowB = createRow('row-2', 60, 60)
    const rowC = createRow('row-3', 120, 60)
    const after = createMarker(180, 1)
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA, rowB, after)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerRowElement('row-2', rowB)
    adapter.registerAfterTriggerElement(after)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    container.dispatchEvent(new Event('scroll'))
    observers.intersectionObservers[0]?.trigger(after, true)
    const afterRequest = events.find((event) =>
      event.type === 'needMoreAfter'
    )
    expect(afterRequest).toEqual(expect.objectContaining({
      type: 'needMoreAfter',
    }))

    container.insertBefore(rowC, after)
    adapter.registerRowElement('row-3', rowC)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2'), item('row-3')], 1, 2, {
      hasMoreAfter: false,
      modifier: {
        type: 'extend-after',
        requestToken: afterRequest?.requestToken ?? '',
      },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot().edgeState.after.status).toBe('exhausted')

    adapter.registerRowElement('row-3', null)
    runtime.applyLoadedSegment(segment([item('row-0'), item('row-1'), item('row-2')], 1, 3, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'trim-after', trimToken: 'trim:3' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot().edgeState.after.status).toBe('idle')

    const previousAfterNeeds = events.filter((event) =>
      event.type === 'needMoreAfter'
    ).length
    container.dispatchEvent(new Event('scroll'))
    observers.intersectionObservers[0]?.trigger(after, true)

    expect(events.filter((event) => event.type === 'needMoreAfter'))
      .toHaveLength(previousAfterNeeds + 1)
  })

  it('lets explicit user scroll cancel underflow before ordinary edge paging resumes', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const before = createMarker(0, 1)
    const row = createRow('row-1', 1, 20)
    const after = createMarker(21, 1)
    const events: MessageListRuntimeEvent[] = []

    container.append(before, row, after)
    runtime.attachScrollContainer(container)
    adapter.registerBeforeTriggerElement(before)
    adapter.registerAfterTriggerElement(after)
    adapter.registerRowElement('row-1', row)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().pendingIntent).toBe('underflow-fill')
    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(1)

    container.dispatchEvent(new Event('scroll'))
    observers.intersectionObservers[1]?.trigger(after, true)

    expect(runtime.getSnapshot().pendingIntent).toBe('edge-after')
    expect(events.some((event) => event.type === 'needMoreAfter')).toBe(true)
  })

  it('keeps underflow pending on passive patches until the matching edge segment settles', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
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
    expect(runtime.getSnapshot().pendingIntent).toBe('underflow-fill')

    runtime.applyLoadedSegment(segment([item('row-1')], 1, 2, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'patch', changedKeys: ['row-1'] },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().pendingIntent).toBe('underflow-fill')
    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'needMoreAfter')).toHaveLength(0)
  })

  it('restores a remote destination with the saved offset inside the message', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 80)
    const rowB = createRow('row-2', 80, 80)
    const targetRow = createRow('row-3', 160, 80)
    const rowD = createRow('row-4', 240, 80)
    const target = { sessionId: 'source-a', stableId: 'row-3', serverId: 'row-3' }
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.restoreToMessage(target, {
      align: 'start',
      offsetWithinMessage: 30,
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMessagesAround',
      reason: 'restore',
      target,
    }))

    container.append(rowB, targetRow, rowD)
    adapter.registerRowElement('row-2', rowB)
    adapter.registerRowElement('row-3', targetRow)
    adapter.registerRowElement('row-4', rowD)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2'), item('row-3'), item('row-4')], 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(190)
    expect(runtime.getSnapshot().pendingIntent).toBeNull()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      intent: 'restore',
      target,
      resolution: 'target',
      resolvedTarget: expect.objectContaining({ stableId: 'row-3' }),
    }))
  })

  it('settles a deleted destination against the fallback anchor', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 50)
    const fallbackRow = createRow('row-4', 50, 50)
    const target = { sessionId: 'source-a', stableId: 'row-3', serverId: 'row-3' }
    const fallback = { sessionId: 'source-a', stableId: 'row-4', serverId: 'row-4' }
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.scrollToMessage(target, { align: 'center' })
    container.append(fallbackRow)
    adapter.registerRowElement('row-4', fallbackRow)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-4')], 2, 1, {
      modifier: { type: 'reset-around', target },
      anchor: fallback,
      anchorStatus: 'deleted',
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      intent: 'jump',
      target,
      resolution: 'fallback',
      resolvedTarget: fallback,
    }))
  })

  it('emits segment trim pressure with the current anchor and preferred side', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 5 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 40, 40)
    )
    const events: MessageListRuntimeEvent[] = []

    container.append(...rows)
    runtime.attachScrollContainer(container)
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(rows.map((row) =>
      item(row.dataset.runtimeKey as string)
    ), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'segmentTrimPressure',
      sessionId: 'source-a',
      generation: 1,
      segmentRevision: 1,
      itemCount: 5,
      anchor: expect.objectContaining({ stableId: 'row-1' }),
      preferredTrimSide: 'after',
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
  row.dataset.rowKind = 'message'
  row.dataset.messageStableId = key
  row.dataset.messageServerId = key
  setElementMetrics(row, { top, height })
  return row
}

function createMarker(top: number, height: number): HTMLDivElement {
  const marker = document.createElement('div')
  setElementMetrics(marker, { top, height })
  return marker
}
