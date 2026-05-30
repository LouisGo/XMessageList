import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
} from '../index'
import { getMessageListAdapterRuntime } from '../internal'
import {
  createContainer,
  setElementMetrics,
} from '../../test/fakes'

describe('MessageList warm attach restore', () => {
  it('restores the same runtime scrollTop when reattached to a reused container', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 4 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50)
    )

    container.append(...rows)
    runtime.attachScrollContainer(container)
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(rows.map((row) =>
      item(row.dataset.runtimeKey as string)
    )))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    container.scrollTop = 75
    runtime.detachScrollContainer()
    container.scrollTop = 0
    runtime.attachScrollContainer(container)

    expect(container.scrollTop).toBe(75)
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
): LoadedSegment<string> {
  return {
    feedId: 'feed-a',
    generation: 1,
    segmentRevision: 1,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'bootstrap' },
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
