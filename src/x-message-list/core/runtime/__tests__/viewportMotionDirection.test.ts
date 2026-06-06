import { describe, expect, it } from 'vitest'
import {
  createMessageListRuntime,
  type LoadedSegment,
  type MessageDataItem,
} from '../index'
import { getMessageListAdapterRuntime, type MessageListAdapterRuntime } from '../internal'
import type { MessageIdentityAnchor } from '../contracts/identity'
import type { MessageListRuntime } from '../controller/runtime'
import { FakeScheduler, createContainer, setElementMetrics } from '../../../../test/fakes'

describe('MessageList viewport motion direction', () => {
  it('uses follow-bottom direction after reset when DOM already landed at bottom', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', scheduler })
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

    replaceRows(adapter, container, latestRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(latestRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: false,
      modifier: { type: 'reset-latest' },
    }))
    container.scrollTop = 250
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toMatchObject({
      viewportPhase: 'IDLE',
      bottomLockState: 'LOCKED',
    })
    expect(container.scrollTop).toBe(250)
    expect(runtime.getDiagnostics().map((record) => record.name))
      .not.toContain('destinationMotion.start')
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'scrollMotion.decision',
      details: expect.objectContaining({
        decision: 'tiny-settle',
        direction: 'down',
        rawDirection: 'none',
        directionHint: 'after',
        enforceDirectionHint: true,
      }),
    }))

    expect(container.scrollTop).toBe(250)
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
  })

  it('uses destination direction for reset-around motion when DOM lands on the wrong side', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a', scheduler })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const initialRows = createRows(4, 50)
    const targetRows = createRows(70, 50)
    const target = anchor('row-30')
    const targetTop = 1_450

    mountRows(runtime, adapter, container, initialRows)
    runtime.applyLoadedSegment(segment(itemsFromRows(initialRows), 1, 1))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)
    runtime.scrollToMessage(target, {
      align: 'start',
      motion: { direction: 'before' },
    })

    replaceRows(adapter, container, targetRows)
    container.scrollTop = 1_000
    positionRows(targetRows, 1_000)
    runtime.applyLoadedSegment(segment(itemsFromRows(targetRows), 2, 1, {
      hasMoreBefore: true,
      hasMoreAfter: true,
      modifier: { type: 'reset-around', target },
      anchor: target,
    }))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot().viewportPhase).toBe('MOTION')
    expect(container.scrollTop).toBeGreaterThan(targetTop)
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'destinationMotion.start',
      details: expect.objectContaining({
        source: 'jump',
        direction: 'up',
        rawDirection: 'down',
        directionHint: 'before',
        enforceDirectionHint: true,
      }),
    }))
    expect(runtime.getDiagnostics()).toContainEqual(expect.objectContaining({
      name: 'scrollMotion.decision',
      details: expect.objectContaining({
        decision: 'bounded-animate',
        directionHint: 'before',
        enforceDirectionHint: true,
        semanticPrepositionTop: expect.any(Number),
      }),
    }))

    scheduler.flushFrames(40)

    expect(container.scrollTop).toBe(targetTop)
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

function replaceRows(
  adapter: MessageListAdapterRuntime<string>,
  container: HTMLElement,
  rows: HTMLDivElement[],
): void {
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
      sessionId: 'source-a',
      stableId: key,
      serverId: key,
      version: 1,
    },
  }
}

function anchor(key: string): MessageIdentityAnchor {
  return {
    sessionId: 'source-a',
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
    sessionId: 'source-a',
    generation,
    segmentRevision,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'bootstrap' },
    ...overrides,
  }
}
