import { describe, expect, it, vi } from 'vitest'
import { createContainer } from '../../test/fakes'
import { MessageViewportRuntime } from '../MessageViewportRuntime'
import { MessageViewportRuntimeController } from './runtimeController'
import type {
  MessageDataItem,
  ProjectionCommitToken,
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
  readonly revision?: number
  readonly hasMoreAfter?: boolean
  readonly modifier?: 'none' | 'items-change' | 'append'
}) {
  return {
    feedId: 'feed',
    generation: 1,
    revision: input.revision ?? 1,
    items: input.items,
    hasMoreBefore: false,
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

  it('supports segmentShift as an explicit transaction path', () => {
    const controller = new MessageViewportRuntimeController<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    controller.attach(createContainer({ height: 320 }))
    controller.setDataSnapshot(snapshot({
      items: [item('m-1'), item('m-2'), item('m-3')],
    }))
    controller.dispatch({ type: 'bootstrap', mode: 'latest' })
    controller.notifyProjectionCommitted(controller.getSnapshot().commitToken)
    const firstSegmentId = controller.getPhysicalScrollMetrics().physicalSegmentId

    controller.enqueueInternalTransaction({
      kind: 'segmentShift',
      direction: 'after',
    })
    const token = controller.getSnapshot().commitToken
    expect(controller.getPhysicalScrollMetrics().physicalSegmentId).toBe(firstSegmentId)
    controller.notifyProjectionCommitted(token)
    expect(controller.getPhysicalScrollMetrics().physicalSegmentId).toBe(
      token.segmentId,
    )
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
