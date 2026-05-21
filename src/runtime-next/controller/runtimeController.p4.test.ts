import { describe, expect, it, vi } from 'vitest'
import { createContainer, setElementMetrics } from '../../test/fakes'
import { MessageViewportRuntime } from '../MessageViewportRuntime'
import { MessageViewportRuntimeController } from './runtimeController'
import type {
  MessageDataItem,
  MessageViewportSnapshot,
  ProjectionCommitToken,
  RuntimeNextViewportEvent,
} from '../types'

function item(messageId: string, estimatedHeight = 64): MessageDataItem<{ text: string }> {
  return {
    kind: 'committed',
    key: {
      kind: 'committed',
      messageId,
    },
    message: {
      text: messageId,
    },
    version: 1,
    estimatedHeight,
  }
}

function snapshot(input: {
  readonly items: readonly MessageDataItem<{ text: string }>[]
  readonly feedId?: string
  readonly generation?: number
  readonly revision?: number
  readonly hasMoreBefore?: boolean
  readonly hasMoreAfter?: boolean
  readonly anchor?: { readonly messageId: string; readonly position?: number }
  readonly anchorStatus?: 'normal' | 'deleted'
  readonly modifier?: 'none' | 'items-change' | 'append' | 'auto-scroll-to-bottom'
}) {
  return {
    feedId: input.feedId ?? 'feed',
    generation: input.generation ?? 1,
    revision: input.revision ?? 1,
    items: input.items,
    anchor: input.anchor,
    anchorStatus: input.anchorStatus ?? 'normal',
    hasMoreBefore: input.hasMoreBefore ?? false,
    hasMoreAfter: input.hasMoreAfter ?? false,
    change: {
      kind: input.modifier === 'append' ? 'append' as const : 'patch' as const,
      viewportModifier: input.modifier ?? 'none',
    },
  }
}

function commit(runtime: MessageViewportRuntime<{ text: string }>): ProjectionCommitToken {
  const token = runtime.getSnapshot().commitToken
  runtime.notifyProjectionCommitted(token)

  return token
}

function row(height: number, top = 0): HTMLElement {
  const element = document.createElement('div')
  setElementMetrics(element, { top, height })

  return element
}

function committedIds(input: {
  getSnapshot: () => MessageViewportSnapshot<{ text: string }>
}): string[] {
  return input.getSnapshot().items
    .map((snapshotItem) =>
      snapshotItem.key.kind === 'committed'
        ? snapshotItem.key.messageId
        : snapshotItem.key.clientMessageId)
}

describe('runtime-next P4 transaction integration', () => {
  it('keeps pending projection separate from committed physical metrics', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({ items: [item('m-1')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })

    const pending = runtime.getSnapshot()
    expect(pending.items).toHaveLength(1)
    expect(pending.commitToken.segmentRevision).toBe(1)
    expect(runtime.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(0)

    runtime.notifyProjectionCommitted({
      ...pending.commitToken,
      transactionId: 'stale',
    })
    expect(runtime.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(0)

    runtime.notifyProjectionCommitted(pending.commitToken)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        physicalSegmentId: pending.commitToken.segmentId,
        physicalSegmentRevision: pending.commitToken.segmentRevision,
        physicalWindowSize: 320,
        domScrollHeight: 320,
      }),
    )
    expect(
      runtime.getDiagnosticRecords()
        .filter((record) => record.kind === 'transaction-lifecycle')
        .map((record) => record.details?.stage),
    ).toEqual(
      expect.arrayContaining([
        'queued',
        'running',
        'projection-published',
        'commit-ack',
        'measurement-correction',
        'metrics-promoted',
      ]),
    )
  })

  it('keeps projectionRefresh payload-only across commit', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({ items: [item('m-1')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    const committedMetrics = runtime.getPhysicalScrollMetrics()

    runtime.setDataSnapshot(snapshot({
      items: [
        {
          kind: 'committed',
          key: {
            kind: 'committed',
            messageId: 'm-1',
          },
          message: { text: 'updated' },
          version: 2,
          estimatedHeight: 64,
        },
      ],
      revision: 2,
      modifier: 'items-change',
    }))
    const refreshToken = runtime.getSnapshot().commitToken
    expect(runtime.getSnapshot().items[0]?.version).toBe(2)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(committedMetrics)
    runtime.notifyProjectionCommitted(refreshToken)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(committedMetrics)
    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.message === 'transaction projectionRefresh -> metrics-promoted',
      ),
    ).toBe(false)
  })

  it('waits for correction projection ack before promoting measured metrics', () => {
    const controller = new MessageViewportRuntimeController<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    controller.attach(createContainer({ height: 200 }))
    controller.setDataSnapshot(snapshot({
      items: [item('m-1', 250)],
      hasMoreAfter: true,
    }))

    controller.enqueueInternalTransaction({ kind: 'reset', reason: 'test' })
    const initialToken = controller.getSnapshot().commitToken
    const key = controller.getSnapshot().renderWindow.itemKeys[0]
    expect(key).toBeDefined()
    controller.registerRow(key!, row(300))
    controller.notifyProjectionCommitted(initialToken)

    const correctionToken = controller.getSnapshot().commitToken
    expect(correctionToken.segmentRevision).toBe(initialToken.segmentRevision)
    expect(correctionToken.projectionRevision).toBe(
      initialToken.projectionRevision + 1,
    )
    expect(controller.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(0)

    controller.notifyProjectionCommitted(correctionToken)
    expect(controller.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        physicalSegmentRevision: correctionToken.segmentRevision,
        physicalWindowSize: 1000,
      }),
    )
    expect(controller.getSnapshot().bottomSpacer).toBe(700)
  })

  it('promotes geometry on the first ack when measurement needs no correction', () => {
    const controller = new MessageViewportRuntimeController<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    controller.attach(createContainer({ height: 200 }))
    controller.setDataSnapshot(snapshot({
      items: [item('m-1', 250)],
      hasMoreAfter: true,
    }))

    controller.enqueueInternalTransaction({ kind: 'reset', reason: 'test' })
    const token = controller.getSnapshot().commitToken
    const key = controller.getSnapshot().renderWindow.itemKeys[0]
    expect(key).toBeDefined()
    controller.registerRow(key!, row(250))
    controller.notifyProjectionCommitted(token)

    expect(controller.getSnapshot().commitToken).toEqual(token)
    expect(controller.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        physicalSegmentRevision: token.segmentRevision,
        physicalWindowSize: 1000,
      }),
    )
  })

  it('restores the stable projection when a pending transaction times out', () => {
    vi.useFakeTimers()
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({ items: [item('m-1')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    const stableSnapshot = runtime.getSnapshot()

    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2')],
      revision: 2,
      modifier: 'append',
    }))
    expect(runtime.getSnapshot()).not.toEqual(stableSnapshot)
    vi.advanceTimersByTime(300)

    expect(runtime.getSnapshot()).toEqual(stableSnapshot)
    vi.useRealTimers()
  })

  it('resolves pending followBottom only after latest data arrives', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const events: string[] = []
    runtime.subscribeEvent((event) => events.push(event.type))
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1')],
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    runtime.dispatch({ type: 'followBottom' })
    expect(events).toContain('needLatestMessages')
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2')],
      revision: 2,
      hasMoreAfter: true,
      modifier: 'append',
    }))
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(events.filter((event) => event === 'needLatestMessages')).toHaveLength(2)
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2'), item('m-3')],
      revision: 3,
      modifier: 'append',
    }))
    const token = commit(runtime)

    expect(runtime.getSnapshot()).toEqual(
      expect.objectContaining({
        bottomLockState: 'LOCKED',
        commitToken: token,
      }),
    )
    expect(runtime.getPhysicalScrollMetrics().physicalSegmentId).toBe(
      token.segmentId,
    )
  })

  it('treats auto-scroll-to-bottom data as followBottom intent', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const events: string[] = []
    runtime.subscribeEvent((event) => events.push(event.type))
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1')],
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2')],
      revision: 2,
      hasMoreAfter: true,
      modifier: 'auto-scroll-to-bottom',
    }))
    expect(events).toContain('needLatestMessages')
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')

    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2'), item('m-3')],
      revision: 3,
      modifier: 'auto-scroll-to-bottom',
    }))
    commit(runtime)
    expect(runtime.getSnapshot().bottomLockState).toBe('LOCKED')
  })

  it('does not promote followBottom when the drag writer owns scrollTop', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 200 }))
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1', 250)],
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    const stableSnapshot = runtime.getSnapshot()
    const stableMetrics = runtime.getPhysicalScrollMetrics()

    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1', 250), item('m-2', 250)],
      revision: 2,
      modifier: 'auto-scroll-to-bottom',
    }))
    runtime.notifyProjectionCommitted(runtime.getSnapshot().commitToken)

    expect(runtime.getSnapshot()).toEqual(stableSnapshot)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        physicalSegmentId: stableMetrics.physicalSegmentId,
        physicalSegmentRevision: stableMetrics.physicalSegmentRevision,
        isDragLocked: true,
      }),
    )
    expect(runtime.getSnapshot().bottomLockState).toBe('UNLOCKED')
    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.kind === 'writer-arbitration' &&
        record.message === 'transaction writer denied',
      ),
    ).toBe(true)

    runtime.endDirectScroll({ source: 'custom-scrollbar-drag' })
  })

  it('keeps pending jump across partial data arrivals until target exists', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const events: string[] = []
    runtime.subscribeEvent((event) => events.push(event.type))
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({ items: [item('m-1')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    runtime.dispatch({
      type: 'jump',
      target: { messageId: 'm-target' },
    })

    const beforePartialToken = runtime.getSnapshot().commitToken
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2')],
      revision: 2,
      modifier: 'append',
    }))
    expect(runtime.getSnapshot().commitToken).toEqual(beforePartialToken)
    expect(events.filter((event) => event === 'needMessagesAround')).toHaveLength(2)

    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2'), item('m-target')],
      revision: 3,
      modifier: 'append',
    }))
    const token = commit(runtime)
    expect(runtime.getSnapshot().commitToken).toEqual(token)
    expect(events).toContain('destinationSettled')
    expect(
      runtime.getSnapshot().items.some((snapshotItem) =>
        snapshotItem.key.kind === 'committed' &&
        snapshotItem.key.messageId === 'm-target',
      ),
    ).toBe(true)
  })

  it('settles deleted jump targets after promoting fallback anchor geometry', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const events: RuntimeNextViewportEvent[] = []
    runtime.subscribeEvent((event) => events.push(event))
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({ items: [item('m-1'), item('m-2')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    runtime.dispatch({
      type: 'jump',
      target: { messageId: 'm-deleted', position: 7 },
    })

    runtime.setDataSnapshot(snapshot({
      items: [item('m-6'), item('m-fallback'), item('m-8')],
      revision: 2,
      modifier: 'append',
      anchor: { messageId: 'm-fallback', position: 6 },
      anchorStatus: 'deleted',
    }))
    commit(runtime)

    expect(events).toContainEqual({
      type: 'destinationSettled',
      feedId: 'feed',
      generation: 1,
      intent: 'jump',
      target: { messageId: 'm-deleted', position: 7 },
      resolution: 'fallback-deleted',
      resolvedTarget: { messageId: 'm-fallback', position: 6 },
    })
  })

  it('does not publish a blank relayout when logical bounds disappeared', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const events: string[] = []
    runtime.subscribeEvent((event) => events.push(event.type))
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2'), item('m-3')],
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    const stableSnapshot = runtime.getSnapshot()

    runtime.setDataSnapshot(snapshot({
      items: [item('foreign-1'), item('foreign-2')],
      revision: 2,
      modifier: 'items-change',
    }))

    expect(runtime.getSnapshot()).toEqual(stableSnapshot)
    expect(events).toContain('needMessagesAround')
    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.kind === 'transaction-error' &&
        record.message.includes('logical bounds'),
      ),
    ).toBe(true)
  })

  it('rejects data snapshots from another feed or generation', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const events: string[] = []
    runtime.subscribeEvent((event) => events.push(event.type))
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({ items: [item('m-1')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    const currentSnapshot = runtime.getSnapshot()

    runtime.setDataSnapshot(snapshot({
      feedId: 'other-feed',
      items: [item('foreign')],
      revision: 2,
      modifier: 'items-change',
    }))

    expect(runtime.getSnapshot()).toEqual(currentSnapshot)
    expect(events).toContain('viewportError')
    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.kind === 'data-generation-mismatch',
      ),
    ).toBe(true)
  })

  it('supports segmentShift as an explicit adjacent transaction path', () => {
    const controller = new MessageViewportRuntimeController<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    controller.attach(createContainer({ height: 320 }))
    controller.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) =>
        item(`m-${index + 1}`, 400)),
      hasMoreBefore: true,
    }))
    controller.dispatch({ type: 'bootstrap', mode: 'latest' })
    controller.notifyProjectionCommitted(controller.getSnapshot().commitToken)
    const beforeShiftIds = committedIds(controller)

    controller.enqueueInternalTransaction({
      kind: 'segmentShift',
      direction: 'before',
    })
    const token = controller.getSnapshot().commitToken
    expect(controller.getPhysicalScrollMetrics().physicalSegmentId).not.toBe(
      token.segmentId,
    )
    controller.notifyProjectionCommitted(token)
    expect(controller.getPhysicalScrollMetrics().physicalSegmentId).toBe(
      token.segmentId,
    )
    expect(committedIds(controller)).not.toEqual(beforeShiftIds)
    expect(committedIds(controller)).toEqual(['m-3', 'm-4', 'm-5'])
  })

  it('builds segmentShift before from adjacent data only', () => {
    const controller = new MessageViewportRuntimeController<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    controller.attach(createContainer({ height: 320 }))
    controller.setDataSnapshot(snapshot({
      items: Array.from({ length: 8 }, (_, index) =>
        item(`m-${index + 1}`, 400)),
      hasMoreBefore: true,
    }))
    controller.dispatch({ type: 'bootstrap', mode: 'latest' })
    controller.notifyProjectionCommitted(controller.getSnapshot().commitToken)

    controller.enqueueInternalTransaction({
      kind: 'segmentShift',
      direction: 'before',
    })

    expect(committedIds(controller)).toEqual(['m-3', 'm-4', 'm-5'])
  })

  it('keeps direct physical scroll inside the committed safe range', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1', 250)],
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    let projectionChanges = 0
    let physicalChanges = 0
    runtime.subscribe(() => {
      projectionChanges += 1
    })
    runtime.subscribePhysicalScroll(() => {
      physicalChanges += 1
    })

    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
    expect(runtime.writeDirectScrollTop(9999, {
      source: 'custom-scrollbar-drag',
    })).toBe(true)
    expect(container.scrollTop).toBe(
      runtime.getPhysicalScrollMetrics().safeScrollRangeEnd,
    )
    expect(runtime.writeDirectScrollTop(-9999, {
      source: 'custom-scrollbar-drag',
    })).toBe(true)
    runtime.endDirectScroll({ source: 'custom-scrollbar-drag' })

    expect(container.scrollTop).toBe(
      runtime.getPhysicalScrollMetrics().safeScrollRangeStart,
    )
    expect(projectionChanges).toBe(0)
    expect(physicalChanges).toBeGreaterThan(0)
  })

  it('allows custom scrollbar track writes without entering drag lock', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1', 250)],
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    expect(runtime.writeDirectScrollTop(9999, {
      source: 'custom-scrollbar-track',
    })).toBe(true)
    expect(container.scrollTop).toBe(
      runtime.getPhysicalScrollMetrics().safeScrollRangeEnd,
    )
    expect(runtime.getPhysicalScrollMetrics().isDragLocked).toBe(false)
  })

  it('emits a real viewport anchor on detach', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const anchors: Array<unknown> = []
    runtime.subscribeEvent((event) => {
      if (event.type === 'viewportAnchorChanged') anchors.push(event.anchor)
    })
    runtime.attach(createContainer({ height: 200 }))
    runtime.setDataSnapshot(snapshot({
      items: [item('m-1', 250)],
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)
    const key = runtime.getSnapshot().renderWindow.itemKeys[0]
    runtime.registerRow(key!, row(250, -20))

    runtime.detach()

    expect(anchors).toEqual([
      {
        key,
        offsetWithinMessage: 20,
      },
    ])
  })

  it('restores an anchor offset by writing the target row position', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    const items = Array.from({ length: 5 }, (_, index) =>
      item(`m-${index + 1}`, 100))
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({
      items,
      hasMoreBefore: true,
      hasMoreAfter: true,
    }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    runtime.dispatch({
      type: 'restore',
      target: {
        key: items[2].key,
        offsetWithinMessage: 30,
      },
    })
    for (const key of runtime.getSnapshot().renderWindow.itemKeys) {
      runtime.registerRow(key, row(100))
    }
    runtime.notifyProjectionCommitted(runtime.getSnapshot().commitToken)

    expect(container.scrollTop).toBe(480)
    expect(runtime.getPhysicalScrollMetrics().scrollPosition).toBe(480)
  })

  it('records physical geometry diagnostics when metrics are promoted', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({ items: [item('m-1')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.kind === 'physical.windowSelected' &&
        record.owner === 'geometry',
      ),
    ).toBe(true)
  })

  it('records a physical diagnostic when DOM scrollHeight diverges', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const container = createContainer({ height: 200 })
    container.appendChild(row(123))
    runtime.attach(container)
    runtime.setDataSnapshot(snapshot({ items: [item('m-1')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    commit(runtime)

    expect(runtime.getPhysicalScrollMetrics().domScrollHeight).toBe(123)
    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.kind === 'physical.domScrollHeightMismatch' &&
        record.viewport?.domScrollHeight === 123,
      ),
    ).toBe(true)
  })

  it('aborts timeout transactions and ignores stale commit acks', () => {
    vi.useFakeTimers()
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 320 }))
    runtime.setDataSnapshot(snapshot({ items: [item('m-1')] }))
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    const staleToken = runtime.getSnapshot().commitToken
    vi.advanceTimersByTime(300)
    runtime.notifyProjectionCommitted(staleToken)

    expect(runtime.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(0)
    expect(
      runtime.getDiagnosticRecords().some((record) =>
        record.kind === 'transaction-error' &&
        record.details?.stage === 'aborted',
      ),
    ).toBe(true)
    vi.useRealTimers()
  })
})
