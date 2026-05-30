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

describe('MessageList viewport motion', () => {
  it('animates local jump destinations and settles the destination after motion', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    const events: MessageListRuntimeEvent[] = []
    const target = anchor('row-1')

    mountRows(runtime, adapter, container, rows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    positionRows(rows, 200)

    runtime.scrollToMessage(target, {
      align: 'start',
      motion: { direction: 'before' },
    })

    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    expect(events.some((event) => event.type === 'destinationSettled')).toBe(false)
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({
        source: 'jump',
        directionHint: 'before',
      }),
    }))

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(0)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'destinationSettled',
      intent: 'jump',
      target,
      resolvedTarget: target,
    }))
  })

  it('keeps follow-bottom unlocked during motion and locks after settle', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 0
    positionRows(rows, 0)

    runtime.scrollToLatest()

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      bottomLockState: 'UNLOCKED',
    })

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(200)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('cancels active motion on explicit user scroll input', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      observers: null,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)

    mountRows(runtime, adapter, container, rows)
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 0
    positionRows(rows, 0)
    runtime.scrollToLatest()
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')

    container.scrollTop = 40
    container.dispatchEvent(new Event('wheel'))
    scheduler.flushFrame()
    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(40)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'UNLOCKED',
    })
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.cancel',
      details: expect.objectContaining({ reason: 'user-interrupt' }),
    }))
  })

  it('lets a new transaction supersede motion without publishing a cancelled destination settle', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(6, 50)
    const events: MessageListRuntimeEvent[] = []
    const phases: string[] = []
    const target = anchor('row-1')

    mountRows(runtime, adapter, container, rows)
    runtime.subscribeRuntimeEvent((event) => events.push(event))
    runtime.subscribeSnapshot(() => { phases.push(runtime.getSnapshot().viewportPhase) })
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    container.scrollTop = 200
    positionRows(rows, 200)
    runtime.scrollToMessage(target, { align: 'start' })
    const phaseCountBeforeSupersede = phases.length

    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 2, {
      modifier: { type: 'patch', changedKeys: ['row-2'] },
    }))

    expect(phases.slice(phaseCountBeforeSupersede)).toEqual(['PROJECTING'])
    expect(runtime.getSnapshot().viewportPhase).toBe('PROJECTING')
    expect(events.some((event) =>
      event.type === 'destinationSettled' && event.target.stableId === 'row-1'
    )).toBe(false)

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    scheduler.flushFrames(40)

    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
    expect(events.some((event) =>
      event.type === 'destinationSettled' && event.target.stableId === 'row-1'
    )).toBe(false)
  })

  it('starts queued transactions before opening a post-commit motion opportunity', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = createRows(7, 50)
    const phases: string[] = []

    mountRows(runtime, adapter, container, rows.slice(0, 5))
    runtime.subscribeSnapshot(() => { phases.push(runtime.getSnapshot().viewportPhase) })
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 5)), 1, 1, {
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToLatest()
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')

    container.append(rows[5], rows[6])
    adapter.registerRowElement('row-6', rows[5])
    adapter.registerRowElement('row-7', rows[6])
    runtime.applyLoadedSegment(segment(itemsFromRows(rows.slice(0, 6)), 1, 2, {
      modifier: { type: 'patch', changedKeys: ['row-6'] },
    }))
    const firstToken = runtime.getSnapshot().commitToken
    runtime.applyLoadedSegment(segment(itemsFromRows(rows), 1, 3, {
      modifier: { type: 'patch', changedKeys: ['row-7'] },
    }))
    const phaseCountBeforeAck = phases.length

    adapter.ackProjectionCommit(firstToken)

    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 3,
      viewportPhase: 'PROJECTING',
    })
    expect(phases.slice(phaseCountBeforeAck)).not.toContain('MOTION')

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    scheduler.flushFrames(40)
    expect(runtime.getSnapshot()).toMatchObject({
      segmentRevision: 3,
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('uses follow-bottom motion for send-style latest rebuilds', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ feedId: 'feed-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const previousRows = createRows(2, 50)
    const latestRows = createRows(7, 50)

    mountRows(runtime, adapter, container, previousRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(previousRows), 1, 1, {
      hasMoreAfter: true,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.scrollToLatest()
    expect(runtime.getSnapshot()).toMatchObject({
      pendingIntent: 'follow-bottom',
      bottomLockState: 'UNLOCKED',
    })

    container.replaceChildren(...latestRows)
    for (const row of latestRows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(itemsFromRows(latestRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: false,
      modifier: { type: 'reset-latest' },
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'MOTION',
      pendingIntent: null,
      bottomLockState: 'UNLOCKED',
    })
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({ source: 'followBottom' }),
    }))

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(250)
    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
  })

  it('does not apply direction hints or far preposition for cross-feed jumps', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      feedId: 'feed-a',
      scheduler,
      scrollMotion: { maxDistancePx: 80 },
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRows = createRows(2, 50)
    const targetRows = createRows(24, 50)
    const target = anchor('row-22')

    mountRows(runtime, adapter, container, initialRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(initialRows), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToMessage(target, {
      align: 'start',
      motion: { crossFeed: true },
    })

    container.replaceChildren(...targetRows)
    for (const row of targetRows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    expect(container.scrollTop).toBe(0)
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({
        source: 'jump',
        directionHint: null,
      }),
    }))
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'scrollMotion.decision',
      details: expect.objectContaining({
        decision: 'bounded-animate',
        prepositionTop: null,
      }),
    }))

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(1_050)
    expect(runtime.getSnapshot().viewportPhase).toBe('IDLE')
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
  for (const row of rows) {
    adapter.registerRowElement(row.dataset.runtimeKey as string, row)
  }
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

function positionRows(rows: HTMLDivElement[], scrollTop: number): void {
  rows.forEach((row, index) => {
    setElementMetrics(row, { top: index * 50 - scrollTop, height: 50 })
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
