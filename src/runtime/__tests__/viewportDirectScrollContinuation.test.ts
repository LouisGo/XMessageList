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
} from '../../test/fakes'

describe('MessageList direct scrollbar continuation', () => {
  it('continues requesting after-edge data after a direct drag commit while still active', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', observers })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rowA = createRow('row-1', 0, 120)
    const rowB = createRow('row-2', 120, 80)
    const after = createMarker(200, 1)
    const events: MessageListRuntimeEvent[] = []

    container.append(rowA, after)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', rowA)
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

    const firstRequest = events.find((event) => event.type === 'needMoreAfter')
    container.insertBefore(rowB, after)
    adapter.registerRowElement('row-2', rowB)
    runtime.applyLoadedSegment(segment([item('row-1'), item('row-2')], 1, 2, {
      hasMoreAfter: true,
      modifier: {
        type: 'extend-after',
        requestToken: firstRequest?.requestToken ?? '',
      },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    adapter.endDirectScroll()

    expect(events.filter((event) => event.type === 'needMoreAfter')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({
      type: 'needMoreAfter',
      reason: 'near-after',
    })
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
