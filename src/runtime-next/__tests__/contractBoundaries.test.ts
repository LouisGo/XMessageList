import { describe, expect, it } from 'vitest'
import {
  MessageViewportRuntime,
  isProjectionCommitTokenEqual,
  type ProjectionCommitToken,
  type RuntimeNextCommand,
  type RuntimeNextDataSnapshot,
} from '../index'

const forbiddenProjectionKeys = [
  'scrollTop',
  'scrollHeight',
  'physicalWindowHeight',
  'safeScrollRange',
  'thumbGeometry',
]

const forbiddenCommandKeys = [
  'topSpacer',
  'bottomSpacer',
  'physicalWindowHeight',
  'segmentRevision',
  'renderRows',
  'scrollTop',
]

const nonGeometryOwnerSources = import.meta.glob<string>(
  '../{commands,data,components}/**/*.{ts,tsx}',
  {
    eager: true,
    import: 'default',
    query: '?raw',
  },
)

const geometryMutationFieldPattern =
  /\b(topSpacer|bottomSpacer|physicalWindowHeight|segmentRevision|renderRows|PhysicalScrollMetrics)\b/

describe('runtime-next P2 contract boundaries', () => {
  it('keeps projection snapshot separate from physical metrics', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const snapshot = runtime.getSnapshot()
    const metrics = runtime.getPhysicalScrollMetrics()

    expect(Object.keys(snapshot)).not.toEqual(
      expect.arrayContaining(forbiddenProjectionKeys),
    )
    expect(snapshot).toEqual(
      expect.objectContaining({
        rows: [],
        topSpacer: 0,
        bottomSpacer: 0,
      }),
    )
    expect(metrics).toEqual(
      expect.objectContaining({
        physicalWindowHeight: 0,
        safeScrollRange: { min: 0, max: 0 },
      }),
    )
  })

  it('matches projection commit tokens by every required identity field', () => {
    const token: ProjectionCommitToken = {
      feedId: 'feed',
      generation: 1,
      projectionRevision: 2,
      segmentId: 'segment',
      segmentRevision: 3,
      transactionId: 'transaction',
    }

    expect(isProjectionCommitTokenEqual(token, { ...token })).toBe(true)
    expect(
      isProjectionCommitTokenEqual(token, {
        ...token,
        segmentRevision: token.segmentRevision + 1,
      }),
    ).toBe(false)
    expect(
      isProjectionCommitTokenEqual(token, {
        ...token,
        transactionId: 'other-transaction',
      }),
    ).toBe(false)
  })

  it('keeps command and data contracts semantic-only', () => {
    const command: RuntimeNextCommand = {
      type: 'jump',
      target: {
        messageId: 'm-1',
        align: 'center',
      },
    }
    const snapshot: RuntimeNextDataSnapshot<{ text: string }> = {
      feedId: 'feed',
      generation: 1,
      dataRevision: 1,
      items: [
        {
          key: 'm-1',
          payload: { text: 'hello' },
          estimatedHeight: 48,
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: true,
    }

    expect(Object.keys(command)).not.toEqual(
      expect.arrayContaining(forbiddenCommandKeys),
    )
    expect(Object.keys(snapshot)).not.toEqual(
      expect.arrayContaining(forbiddenCommandKeys),
    )
  })

  it('does not let non-geometry domains publish geometry mutation fields', () => {
    const violations = Object.entries(nonGeometryOwnerSources)
      .filter(([, source]) => geometryMutationFieldPattern.test(source))
      .map(([path]) => path)

    expect(violations).toEqual([])
  })

  it('keeps the P2 facade as a no-geometry contract skeleton', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const token = runtime.getSnapshot().commitToken

    expect(runtime.notifyProjectionCommitted(token)).toBe(true)
    expect(
      runtime.notifyProjectionCommitted({
        ...token,
        projectionRevision: token.projectionRevision + 1,
      }),
    ).toBe(false)

    runtime.dispatch({ type: 'followBottom' })
    runtime.setDataSnapshot({
      feedId: 'feed',
      generation: 1,
      dataRevision: 1,
      items: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
    })

    expect(runtime.getContractDebugSnapshot()).toEqual(
      expect.objectContaining({
        lastCommand: { type: 'followBottom' },
        lastCommitAccepted: false,
      }),
    )
    expect(runtime.getDiagnosticRecords()).toEqual([])
  })
})

