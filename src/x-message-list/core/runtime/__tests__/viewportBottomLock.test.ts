import { describe, expect, it } from 'vitest'
import type { MessageDataItem } from '../contracts/identity'
import type { LoadedSegment } from '../contracts/segment'
import { createMessageListRuntime } from '../controller/runtime'
import { getMessageListAdapterRuntime } from '../internal'
import {
  createContainer,
  createFakeObservers,
  FakeScheduler,
  setElementMetrics,
} from '../../../../test/fakes'

describe('MessageList bottom lock observation', () => {
  it('connects edge observers when triggers register before the scroll container', () => {
    const observers = createFakeObservers()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      observers,
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const before = document.createElement('div')
    const after = document.createElement('div')

    adapter.registerBeforeTriggerElement(before)
    adapter.registerAfterTriggerElement(after)
    runtime.attachScrollContainer(container)

    expect(observers.intersectionObservers).toHaveLength(2)
    expect(observers.intersectionObservers[0]?.observed.has(before)).toBe(true)
    expect(observers.intersectionObservers[1]?.observed.has(after)).toBe(true)
  })

  it('unlocks bottom follow when ordinary scroll moves away from native bottom', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
      observers: createFakeObservers(),
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 6 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50),
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

    runtime.scrollToLatest()
    scheduler.flushFrames(40)
    expect(runtime.getEvidence().bottomLockState).toBe('LOCKED')

    container.scrollTop = 0
    container.dispatchEvent(new Event('scroll'))
    scheduler.flushFrame()

    expect(runtime.getEvidence().bottomLockState).toBe('UNLOCKED')
  })

  it('unlocks immediately when user scrolls upward inside the bottom threshold', () => {
    const scheduler = new FakeScheduler()
    const runtime = createMessageListRuntime<string>({
      sessionId: 'source-a',
      scheduler,
      observers: createFakeObservers(),
    })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 6 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50),
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
    runtime.scrollToLatest()
    scheduler.flushFrames(40)
    expect(container.scrollTop).toBe(200)
    expect(runtime.getEvidence().bottomLockState).toBe('LOCKED')

    container.scrollTop = 190
    container.dispatchEvent(new Event('wheel'))
    scheduler.flushFrame()

    expect(runtime.getEvidence().bottomLockState).toBe('UNLOCKED')
  })
})

function createRow(key: string, top: number, height: number): HTMLDivElement {
  const row = document.createElement('div')
  row.dataset.runtimeKey = key
  row.dataset.messageStableId = key
  row.dataset.messageServerId = key
  row.dataset.rowKind = 'message'
  setElementMetrics(row, { top, height })
  return row
}

function item(key: string): MessageDataItem<string> {
  return {
    key,
    rowKind: 'message',
    identity: {
      sessionId: 'source-a',
      stableId: key,
      serverId: key,
      version: 1,
    },
    renderVersion: 1,
    message: key,
  }
}

function segment(items: MessageDataItem<string>[]): LoadedSegment<string> {
  return {
    sessionId: 'source-a',
    generation: 1,
    segmentRevision: 1,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    modifier: { type: 'reset-latest' },
  }
}
