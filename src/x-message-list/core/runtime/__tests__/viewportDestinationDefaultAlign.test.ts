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
  FakeScheduler,
  setElementMetrics,
} from '../../../../test/fakes'

describe('MessageList destination default alignment', () => {
  it('centers local and reset-around jump destinations by default', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 5 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50)
    )
    const localTarget = { feedId: 'feed-a', stableId: 'row-4', serverId: 'row-4' }
    const remoteTarget = { feedId: 'feed-a', stableId: 'row-3', serverId: 'row-3' }
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

    runtime.scrollToMessage(localTarget)
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    scheduler.flushFrames(40)
    expect(container.scrollTop).toBe(125)
    expect(events.some((event) => event.type === 'needMessagesAround')).toBe(false)

    for (const row of rows.slice(1)) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, null)
      row.remove()
    }
    runtime.applyLoadedSegment(segment([item('row-1')], 2, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.scrollToMessage(remoteTarget)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'needMessagesAround',
      target: remoteTarget,
    }))
    container.append(...rows.slice(1))
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(rows.map((row) =>
      item(row.dataset.runtimeKey as string)
    ), 3, 1, {
      modifier: { type: 'reset-around', target: remoteTarget },
      anchor: remoteTarget,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    scheduler.flushFrames(40)
    expect(container.scrollTop).toBe(75)
  })

  it('uses reset-around restore alignment before the first settled paint', () => {
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 5 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50)
    )
    const target = { feedId: 'feed-a', stableId: 'row-3', serverId: 'row-3' }

    container.append(...rows)
    runtime.attachScrollContainer(container)
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }

    runtime.applyLoadedSegment(segment(rows.map((row) =>
      item(row.dataset.runtimeKey as string)
    ), 1, 1, {
      modifier: {
        type: 'reset-around',
        target,
        align: 'start',
        offsetWithinMessage: 12,
      },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(112)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
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
