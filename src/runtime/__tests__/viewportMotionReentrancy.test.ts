import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
  type MessageListRuntimeEvent,
} from '../index'
import { getMessageListAdapterRuntime, type MessageListAdapterRuntime } from '../internal'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { MessageListRuntime } from '../controller/runtime'
import { FakeScheduler, createContainer, setElementMetrics } from '../../test/fakes'

describe('MessageList viewport motion reentrancy', () => {
  it('does not carry deferred destination motion across detach and restore', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRows = createRows(1, 50)
    const targetRows = createRows(5, 50)
    const events: MessageListRuntimeEvent[] = []
    const target = anchor('row-4')

    mountRows(runtime, adapter, container, initialRows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(initialRows), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToMessage(target, { align: 'start' })

    replaceRows(adapter, container, targetRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    const resetToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 2, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'patch', changedKeys: ['row-2'] },
      anchor: target,
    }))

    adapter.ackProjectionCommit(resetToken)
    runtime.detachScrollContainer()
    runtime.attachScrollContainer(container)
    for (const row of targetRows) adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    scheduler.flushFrames(40)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(events.some((event) =>
      event.type === 'destinationSettled' &&
      event.target.stableId === target.stableId
    )).toBe(false)
    expect(runtime.getDiagnostics()).not.toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({ source: 'jump' }),
    }))
  })

  it('settles underflow fill without bottom motion after a restored latest lock', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRows = createRows(1, 50)
    const latestRows = createRows(2, 50)
    const filledRows = createRows(4, 50)
    const events: MessageListRuntimeEvent[] = []

    mountRows(runtime, adapter, container, initialRows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(initialRows), 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToLatest()

    replaceRows(adapter, container, latestRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(latestRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: false,
      modifier: { type: 'reset-latest' },
      anchor: anchor('row-2'),
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    scheduler.flushFrames(40)

    const beforeEvent = events.find((
      event,
    ): event is Extract<MessageListRuntimeEvent, { type: 'needMoreBefore' }> =>
      event.type === 'needMoreBefore' &&
      event.reason === 'underflow-fill'
    )
    expect(beforeEvent).toEqual(expect.objectContaining({ type: 'needMoreBefore' }))
    const motionStartsBefore = runtime.getDiagnostics()
      .filter((record) => record.name === 'destinationMotion.start').length

    replaceRows(adapter, container, filledRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(filledRows), 2, 2, {
      hasMoreBefore: false,
      hasMoreAfter: false,
      modifier: {
        type: 'extend-before',
        requestToken: beforeEvent?.requestToken ?? '',
      },
      anchor: anchor('row-2'),
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    scheduler.flushFrames(40)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(runtime.getDiagnostics()
      .filter((record) => record.name === 'destinationMotion.start')).toHaveLength(motionStartsBefore)
    expect(runtime.getDiagnostics()).not.toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({ source: 'programmatic' }),
    }))
  })

  it('drops pending destination motion when a settle listener publishes a newer generation', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRows = createRows(1, 50)
    const targetRows = createRows(5, 50)
    const newerRows = createRows(2, 50)
    const events: MessageListRuntimeEvent[] = []
    const target = anchor('row-4')
    let publishedNewerGeneration = false

    mountRows(runtime, adapter, container, initialRows)
    runtime.subscribeRuntimeEvent((event) => {
      events.push(event)
      if (
        !publishedNewerGeneration &&
        event.type === 'viewportDiagnostic' &&
        event.record.name === 'transaction.settle' &&
        event.record.details.generation === 2
      ) {
        publishedNewerGeneration = true
        replaceRows(adapter, container, newerRows)
        for (const row of targetRows.slice(newerRows.length)) {
          adapter.registerRowElement(row.dataset.runtimeKey as string, null)
        }
        runtime.applyLoadedSegment(segment(itemsFromRows(newerRows), 3, 1, {
          hasMoreAfter: true,
          modifier: { type: 'reset-latest' },
        }))
      }
    })
    runtime.applyLoadedSegment(segment(itemsFromRows(initialRows), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToMessage(target, { align: 'start' })

    replaceRows(adapter, container, targetRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(publishedNewerGeneration).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject({
      generation: 3,
      viewportPhase: 'PROJECTING',
    })

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot()).toMatchObject({
      generation: 3,
      viewportPhase: 'IDLE',
    })
    scheduler.flushFrames(40)

    expect(events.some((event) =>
      event.type === 'destinationSettled' &&
      event.target.stableId === target.stableId
    )).toBe(false)
    expect(runtime.getDiagnostics()).not.toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({ source: 'jump' }),
    }))
  })
})

function mountRows(
  runtime: MessageListRuntime<string>,
  adapter: MessageListAdapterRuntime<string>,
  container: HTMLElement,
  rows: HTMLDivElement[],
): void {
  container.append(...rows)
  runtime.attachScrollContainer(container)
  for (const row of rows) adapter.registerRowElement(row.dataset.runtimeKey as string, row)
}

function replaceRows(adapter: MessageListAdapterRuntime<string>, container: HTMLElement, rows: HTMLDivElement[]): void {
  container.replaceChildren(...rows)
  for (const row of rows) adapter.registerRowElement(row.dataset.runtimeKey as string, row)
}

function createRows(count: number, height: number): HTMLDivElement[] {
  return Array.from({ length: count }, (_, index) => {
    const key = `row-${index + 1}`
    const row = document.createElement('div')
    row.dataset.runtimeKey = key
    row.dataset.rowKind = 'message'
    row.dataset.messageStableId = key
    row.dataset.messageServerId = key
    setElementMetrics(row, { top: index * height, height })
    return row
  })
}

function itemsFromRows(rows: HTMLDivElement[]): MessageDataItem<string>[] {
  return rows.map((row) => item(row.dataset.runtimeKey as string))
}

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

function anchor(key: string): MessageIdentityAnchor {
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
