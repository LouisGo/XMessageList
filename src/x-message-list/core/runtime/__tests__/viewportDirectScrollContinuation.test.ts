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
} from '../../../../test/fakes'

describe('MessageList direct scrollbar continuation', () => {
  it('keeps a held direct drag to one before-edge request until rebase', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const before = createMarker(0, 1)
    const rowA = createRow('row-1', 1, 180)
    const rowB = createRow('row-0', -79, 80)
    const events: MessageListRuntimeEvent[] = []

    container.append(before, rowA)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
    adapter.registerBeforeTriggerElement(before)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    adapter.beginDirectScroll()
    expect(adapter.writeDirectScrollTop(0)).toBe(true)
    container.dispatchEvent(new Event('scroll'))
    observers.intersectionObservers[0]?.trigger(before, true)
    observers.intersectionObservers[0]?.trigger(before, true)
    expect(adapter.writeDirectScrollTop(0)).toBe(true)
    observers.intersectionObservers[0]?.trigger(before, true)

    const firstRequest = events.find((event) => event.type === 'needMoreBefore')
    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(1)

    container.prepend(rowB)
    adapter.registerRowElement('row-0', rowB)
    runtime.applyLoadedSegment(segment([item('row-0'), item('row-1')], 1, 2, {
      hasMoreBefore: true,
      modifier: {
        type: 'extend-before',
        requestToken: firstRequest?.requestToken ?? '',
      },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    adapter.endDirectScroll()

    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(1)
    expect(runtime.getDiagnostics().map((record) => record.name)).toEqual(
      expect.arrayContaining([
        'directScroll.begin',
        'directScroll.write',
        'directScroll.edgeConsumed',
        'directScroll.end',
      ]),
    )
  })

  it('allows a second same-edge request after rebase and a new direct write', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const before = createMarker(0, 1)
    const rowA = createRow('row-1', 1, 180)
    const rowB = createRow('row-0', -79, 80)
    const events: MessageListRuntimeEvent[] = []

    container.append(before, rowA)
    runtime.attachScrollContainer(container)
    adapter.registerBeforeTriggerElement(before)
    adapter.registerRowElement('row-1', rowA)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    adapter.beginDirectScroll()
    expect(adapter.writeDirectScrollTop(0)).toBe(true)
    observers.intersectionObservers[0]?.trigger(before, true)
    const firstRequest = events.find((event) => event.type === 'needMoreBefore')

    container.prepend(rowB)
    adapter.registerRowElement('row-0', rowB)
    runtime.applyLoadedSegment(segment([item('row-0'), item('row-1')], 1, 2, {
      hasMoreBefore: true,
      modifier: {
        type: 'extend-before',
        requestToken: firstRequest?.requestToken ?? '',
      },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(1)

    adapter.notifyDirectScrollRebased()
    expect(adapter.writeDirectScrollTop(0)).toBe(true)
    observers.intersectionObservers[0]?.trigger(before, true)
    adapter.endDirectScroll()

    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(2)
    expect(events.filter((event) => event.type === 'needMoreBefore').at(-1))
      .toMatchObject({
        type: 'needMoreBefore',
        reason: 'near-before',
      })
  })

  it('lets reverse writes move native scroll while an edge request is pending', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ sessionId: 'feed-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const before = createMarker(0, 1)
    const row = createRow('row-1', 1, 220)
    const after = createMarker(221, 1)
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

    adapter.beginDirectScroll()
    expect(adapter.writeDirectScrollTop(0)).toBe(true)
    observers.intersectionObservers[0]?.trigger(before, true)
    expect(events.filter((event) => event.type === 'needMoreBefore')).toHaveLength(1)

    expect(adapter.writeDirectScrollTop(122)).toBe(true)
    observers.intersectionObservers[1]?.trigger(after, true)
    adapter.endDirectScroll()

    expect(container.scrollTop).toBe(122)
    expect(events.some((event) => event.type === 'needMoreAfter')).toBe(false)
  })
})

function item(key: string): MessageDataItem<string> {
  return {
    key,
    rowKind: 'message',
    renderVersion: 1,
    message: key,
    identity: {
      sessionId: 'feed-a',
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
    sessionId: 'feed-a',
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
