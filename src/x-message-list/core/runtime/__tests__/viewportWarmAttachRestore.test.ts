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
} from '../../../../test/fakes'

describe('MessageList warm attach restore', () => {
  it('restores a warm view by message identity and viewport offset', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 4 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50)
    )
    const attachmentEvents: Array<{
      status: 'applied' | 'anchor-unavailable'
      attachmentRevision: number
    }> = []
    runtime.subscribeRuntimeEvent((event) => {
      if (event.type === 'viewAttachmentSettled') {
        attachmentEvents.push(event)
      }
    })

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
    rows.forEach((row, index) => {
      setElementMetrics(row, { top: index * 50 - 75, height: 50 })
    })
    runtime.detachScrollContainer()
    container.scrollTop = 0
    rows.forEach((row, index) => {
      setElementMetrics(row, { top: index * 50, height: 50 })
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    })
    const token = adapter.attachView(container)

    expect(container.scrollTop).toBe(0)
    adapter.ackViewAttachment(token)

    expect(container.scrollTop).toBe(75)
    expect(attachmentEvents).toEqual([{
      status: 'applied',
      attachmentRevision: token.attachmentRevision,
      type: 'viewAttachmentSettled',
      sessionId: 'source-a',
      generation: 1,
      segmentRevision: 1,
      projectionRevision: 1,
    }])
  })

  it('waits for row refs before acknowledging the warm attach transaction', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 4 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50)
    )

    installClampedScrollTop(container)
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
    rows.forEach((row, index) => {
      setElementMetrics(row, { top: index * 50 - 75, height: 50 })
    })
    container.replaceChildren()
    container.scrollTop = 0
    runtime.detachScrollContainer()

    const token = adapter.attachView(container)

    expect(container.scrollTop).toBe(0)

    container.append(...rows)
    rows.forEach((row, index) => {
      setElementMetrics(row, { top: index * 50, height: 50 })
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    })
    adapter.ackViewAttachment(token)

    expect(container.scrollTop).toBe(75)
  })

  it('settles an acknowledged attachment after an in-flight projection finishes', () => {
    const runtime = createMessageListRuntime<string>({ sessionId: 'source-a' })
    const adapter = getMessageListAdapterRuntime(runtime)
    const container = createContainer({ height: 100 })
    const rows = Array.from({ length: 4 }, (_, index) =>
      createRow(`row-${index + 1}`, index * 50, 50)
    )
    const attachmentEvents: Array<{
      status: 'applied' | 'anchor-unavailable'
      attachmentRevision: number
    }> = []
    runtime.subscribeRuntimeEvent((event) => {
      if (event.type === 'viewAttachmentSettled') {
        attachmentEvents.push(event)
      }
    })

    container.append(...rows)
    runtime.attachScrollContainer(container)
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(rows.map((row) =>
      item(row.dataset.runtimeKey as string)
    )))
    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    runtime.detachScrollContainer()
    const token = adapter.attachView(container)
    for (const row of rows) {
      adapter.registerRowElement(row.dataset.runtimeKey as string, row)
    }
    runtime.applyLoadedSegment(segment(rows.map((row) =>
      item(row.dataset.runtimeKey as string)
    ), 2))

    adapter.ackViewAttachment(token)

    expect(attachmentEvents).toEqual([])

    adapter.ackProjectionCommit(runtime.getSnapshot().commitToken)

    expect(attachmentEvents).toEqual([expect.objectContaining({
      status: 'applied',
      attachmentRevision: token.attachmentRevision,
    })])
  })
})

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

function segment(
  items: MessageDataItem<string>[],
  segmentRevision = 1,
): LoadedSegment<string> {
  return {
    sessionId: 'source-a',
    generation: 1,
    segmentRevision,
    items,
    hasMoreBefore: false,
    hasMoreAfter: false,
    context: 'latest',
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

function installClampedScrollTop(element: HTMLElement): void {
  let scrollTop = 0

  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
      scrollTop = Math.min(Math.max(0, value), maxScrollTop)
    },
  })
}
