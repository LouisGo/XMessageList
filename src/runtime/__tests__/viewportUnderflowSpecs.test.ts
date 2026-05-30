import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type MessageListRuntimeEvent,
} from '../index'
import { getMessageListAdapterRuntime } from '../internal'
import { createContainer, FakeScheduler, setElementMetrics } from '../../test/fakes'

describe('MessageList underflow spec guards', () => {
  it('stops the fill sequence when user scroll intent interrupts it', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
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
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    const firstRequest = events.find((event) => event.type === 'needMoreBefore')

    container.dispatchEvent(new Event('scroll'))
    container.prepend(rowB)
    adapter.registerRowElement('row-0', rowB)
    runtime.applyLoadedSegment(segment([item('row-0'), item('row-1')], 1, 2, {
      hasMoreBefore: true,
      modifier: { type: 'extend-before', requestToken: firstRequest?.requestToken ?? '' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events.filter((event) =>
      event.type === 'needMoreBefore' &&
      event.reason === 'underflow-fill'
    )).toHaveLength(1)
  })

  it('does not continue an old underflow sequence after restore retargets the segment', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRow = createRow('row-1', 0, 20)
    const restoreRows = [
      createRow('row-0', 0, 40),
      createRow('row-2', 40, 50),
      createRow('row-3', 90, 40),
    ]
    const target = anchor('row-2')
    const events: MessageListRuntimeEvent[] = []

    container.append(initialRow)
    runtime.attachScrollContainer(container)
    adapter.registerRowElement('row-1', initialRow)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment([item('row-1')], 1, 1, {
      hasMoreBefore: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.restoreToMessage(target, { align: 'start' })

    container.replaceChildren(...restoreRows)
    for (const row of restoreRows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(restoreRows.map((row) =>
      item(row.dataset.runtimeKey as string)
    ), 2, 1, {
      hasMoreBefore: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(events.filter((event) =>
      event.type === 'needMoreBefore' &&
      event.reason === 'underflow-fill'
    )).toHaveLength(1)
    expect(runtime.getDiagnostics().map((record) => record.name))
      .not.toContain('destinationMotion.start')
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

function anchor(key: string) {
  return {
    feedId: 'feed-a',
    stableId: key,
    serverId: key,
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
