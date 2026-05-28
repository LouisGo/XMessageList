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

describe('MessageList destination state', () => {
  it('clears stale edge latches when a destination reset rebuilds the segment', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const before = createMarker(0, 1)
    const rowA = createRow('row-1', 1, 50)
    const targetRow = createRow('row-9', 51, 50)
    const target = { feedId: 'feed-a', stableId: 'row-9', serverId: 'row-9' }
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
      feedId: 'feed-a',
      scheduler,
      observers: createFakeObservers(),
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 6 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50)
    )
    const items = rows.map((row) => item(row.dataset.runtimeKey as string))
    const target = { feedId: 'feed-a', stableId: 'row-1', serverId: 'row-1' }

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
    scheduler.flushFrame()
    expect(container.scrollTop).toBe(200)

    rows.forEach((row, index) => setElementMetrics(row, {
      top: index * 50 - 200,
      height: 50,
    }))
    runtime.scrollToMessage(target, { align: 'start' })
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
  row.dataset.messageServerId = key
  setElementMetrics(row, { top, height })
  return row
}

function createMarker(top: number, height: number): HTMLDivElement {
  const marker = document.createElement('div')
  setElementMetrics(marker, { top, height })
  return marker
}
