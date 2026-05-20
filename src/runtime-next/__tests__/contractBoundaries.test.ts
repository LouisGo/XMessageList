import { describe, expect, it } from 'vitest'
import implementationContractSource from '../../../docs/viewport-runtime/message-runtime-implementation-contract.md?raw'
import physicalSegmentArchitectureSource from '../../../docs/viewport-runtime/physical-segment-architecture.md?raw'
import runtimeContainerArchitectureSource from '../../../docs/viewport-runtime/runtime-container-architecture.md?raw'
import { MessageViewportRuntime } from '../MessageViewportRuntime'
import { isProjectionCommitTokenEqual } from '../projection/commitToken'
import {
  type ProjectionCommitToken,
} from '../types'
import { createContainer } from '../../test/fakes'
import geometryPublicationTypesSource from '../geometry/publication/publication.types.ts?raw'
import projectionTypesSource from '../projection/types.ts?raw'

const forbiddenProjectionKeys = [
  'scrollTop',
  'scrollHeight',
  'physicalWindowHeight',
  'safeScrollRange',
  'thumbGeometry',
]

const publicFacadeMethodsFromContract = [
  'attach',
  'detach',
  'destroy',
  'setDataSnapshot',
  'dispatch',
  'subscribe',
  'getSnapshot',
  'subscribeEvent',
  'getViewportAnchorState',
  'registerRow',
  'registerTopSpacer',
  'registerBottomSpacer',
  'registerTopSentinel',
  'registerBottomSentinel',
  'notifyProjectionCommitted',
  'getPhysicalScrollMetrics',
  'subscribePhysicalScroll',
  'beginDirectScroll',
  'writeDirectScrollTop',
  'endDirectScroll',
  'getDiagnosticRecords',
] as const

const projectionSnapshotFieldsFromContract = [
  'feedId',
  'generation',
  'revision',
  'commitToken',
  'items',
  'renderWindow',
  'topSpacer',
  'bottomSpacer',
  'naturalBlankHeight',
  'bottomLockState',
  'bootstrapState',
  'viewportPhase',
  'edgeState',
] as const

const physicalMetricsFieldsFromContract = [
  'physicalSegmentId',
  'physicalSegmentRevision',
  'viewportSize',
  'physicalWindowSize',
  'domScrollHeight',
  'scrollPosition',
  'maxScrollPosition',
  'scrollHeightCap',
  'capMode',
  'safeScrollRangeStart',
  'safeScrollRangeEnd',
  'isDragLocked',
  'isThumbFrozen',
  'isSegmentShiftPending',
  'pendingShiftDirection',
  'pendingEdgeOverflowPx',
  'isSegmentShifting',
  'isMomentumLatched',
  'suppressedMomentumDeltaPx',
  'segmentRelayoutState',
  'segmentRelayoutReason',
  'adjacentPrefetchBefore',
  'adjacentPrefetchAfter',
] as const

const viewportPhaseValuesFromMainSpec = [
  'IDLE',
  'RECOVERING',
  'SEGMENT_SHIFTING',
  'DESTINATION_PENDING',
  'MOTION_ACTIVE',
] as const

const deprecatedViewportPhaseValues = [
  'PROJECTING',
  'MEASURING',
  'CORRECTING',
] as const

function extractTypeBlock(source: string, typeName: string): string {
  const start = source.indexOf(`export type ${typeName} =`)
  const end = source.indexOf('\n\n', start)

  return source.slice(start, end)
}

describe('runtime-next contract boundaries', () => {
  it('keeps public facade aligned with the implementation contract', () => {
    const runtime = new MessageViewportRuntime({
      feedId: 'feed',
      generation: 1,
    })

    for (const methodName of publicFacadeMethodsFromContract) {
      expect(implementationContractSource).toContain(`${methodName}(`)
      expect(runtime[methodName]).toEqual(expect.any(Function))
    }
  })

  it('keeps projection snapshot aligned with the implementation contract', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    const snapshot = runtime.getSnapshot()

    expect(Object.keys(snapshot)).not.toEqual(
      expect.arrayContaining(forbiddenProjectionKeys),
    )
    expect(Object.keys(snapshot)).toEqual(
      expect.arrayContaining([...projectionSnapshotFieldsFromContract]),
    )
    for (const fieldName of projectionSnapshotFieldsFromContract) {
      expect(implementationContractSource).toContain(`${fieldName}:`)
    }
    expect(snapshot).toEqual(
      expect.objectContaining({
        revision: 0,
        items: [],
        renderWindow: {
          startIndex: 0,
          endIndex: 0,
          itemKeys: [],
        },
        topSpacer: 0,
        bottomSpacer: 0,
        naturalBlankHeight: 0,
        bottomLockState: 'UNLOCKED',
        bootstrapState: 'INITIAL',
        viewportPhase: 'IDLE',
      }),
    )
    expect(snapshot.revision).toBe(snapshot.commitToken.projectionRevision)
    expect(geometryPublicationTypesSource).toContain('naturalBlankHeight')
  })

  it('keeps viewport phase aligned with runtime-next main specs', () => {
    const viewportPhaseTypeSource = extractTypeBlock(
      projectionTypesSource,
      'ViewportPhase',
    )

    for (const phase of viewportPhaseValuesFromMainSpec) {
      expect(physicalSegmentArchitectureSource).toContain(`| '${phase}'`)
      expect(runtimeContainerArchitectureSource).toContain(`| '${phase}'`)
      expect(viewportPhaseTypeSource).toContain(`| '${phase}'`)
    }

    for (const phase of deprecatedViewportPhaseValues) {
      expect(viewportPhaseTypeSource).not.toContain(`| '${phase}'`)
    }
  })

  it('keeps physical metrics aligned with the implementation contract', () => {
    const runtime = new MessageViewportRuntime({
      feedId: 'feed',
      generation: 1,
    })
    const metrics = runtime.getPhysicalScrollMetrics()

    expect(Object.keys(metrics)).toEqual(
      expect.arrayContaining([...physicalMetricsFieldsFromContract]),
    )
    for (const fieldName of physicalMetricsFieldsFromContract) {
      expect(implementationContractSource).toContain(`${fieldName}:`)
    }
    expect(metrics).toEqual(
      expect.objectContaining({
        physicalSegmentId: null,
        physicalSegmentRevision: 0,
        physicalWindowSize: 0,
        domScrollHeight: 0,
        maxScrollPosition: 0,
        segmentRelayoutState: 'idle',
        segmentRelayoutReason: null,
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

  it('keeps the P4 facade behind commit-token-gated geometry promotion', () => {
    const runtime = new MessageViewportRuntime<{ text: string }>({
      feedId: 'feed',
      generation: 1,
    })
    runtime.attach(createContainer({ height: 320 }))

    runtime.setDataSnapshot({
      feedId: 'feed',
      generation: 1,
      revision: 1,
      items: [
        {
          kind: 'committed',
          key: {
            kind: 'committed',
            messageId: 'm-1',
          },
          message: { text: 'hello' },
          version: 1,
          estimatedHeight: 64,
        },
      ],
      hasMoreBefore: false,
      hasMoreAfter: false,
      change: {
        kind: 'initial',
        viewportModifier: 'none',
      },
    })
    runtime.dispatch({ type: 'bootstrap', mode: 'latest' })
    const pendingToken = runtime.getSnapshot().commitToken

    expect(runtime.getSnapshot()).toEqual(
      expect.objectContaining({
        revision: 1,
        commitToken: pendingToken,
      })
    )
    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        physicalSegmentId: null,
        physicalSegmentRevision: 0,
      }),
    )
    expect(() => {
      runtime.notifyProjectionCommitted({
        ...pendingToken,
        projectionRevision: pendingToken.projectionRevision + 1,
      })
    }).not.toThrow()
    expect(runtime.getPhysicalScrollMetrics().physicalSegmentRevision).toBe(0)
    runtime.notifyProjectionCommitted(pendingToken)
    expect(runtime.getPhysicalScrollMetrics()).toEqual(
      expect.objectContaining({
        physicalSegmentId: pendingToken.segmentId,
        physicalSegmentRevision: pendingToken.segmentRevision,
      }),
    )

    expect(() => {
      runtime.setDataSnapshot({
        feedId: 'feed',
        generation: 1,
        revision: 2,
        items: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
        change: {
          kind: 'delete',
          viewportModifier: 'reserved-test-modifier' as never,
        },
      })
    }).toThrow(/viewport modifier is not implemented/)
    runtime.beginDirectScroll({ source: 'custom-scrollbar-drag' })
    expect(
      runtime.writeDirectScrollTop(100, { source: 'custom-scrollbar-drag' }),
    ).toBe(true)
    runtime.endDirectScroll({ source: 'custom-scrollbar-drag' })
    expect(runtime.getDiagnosticRecords().length).toBeGreaterThan(0)
  })

  it('does not expose test-only debug methods on the public facade', () => {
    const runtime = new MessageViewportRuntime({
      feedId: 'feed',
      generation: 1,
    })

    expect(Object.keys(Object.getPrototypeOf(runtime))).not.toContain(
      'getContractDebugSnapshot',
    )
    expect('getContractDebugSnapshot' in runtime).toBe(false)
  })
})
