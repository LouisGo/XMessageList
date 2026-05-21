import type { PendingDataIntent } from '../data/classifier.types'
import type { MessageDataSnapshot } from '../data/types'
import type { RuntimeNextViewportEvent } from '../events/types'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import type { PhysicalSegmentRevisionController } from '../geometry/segment/segmentRevision'
import type { AdjacentPrefetchState, PhysicalScrollMetrics } from '../geometry/types'
import type { BottomLockState } from '../projection/types'
import type { ProjectionStore } from '../projection/store'
import type { RuntimeDataStore } from '../data/store'
import type { EdgeNeedLatch } from '../scroll/edgeNeedLatch'
import { resolveEdgeNeedRequest } from '../scroll/edgeNeedLatch'
import type { ScrollInteractionState } from '../scroll/interactionState'
import { hasAdjacentSegmentData } from './controllerHelpers'
import { resolveBottomLockState } from './bottomLock'

export type RuntimeInputHelperDeps<TMessage, TOptimistic> = {
  readonly feedId: string
  readonly generation: number
  readonly data: RuntimeDataStore<TMessage, TOptimistic>
  readonly metrics: PhysicalMetricsStore
  readonly revision: PhysicalSegmentRevisionController
  readonly projection: ProjectionStore<TMessage, TOptimistic>
  readonly setBottomLockState: (state: BottomLockState) => void
  readonly emitEvent: (event: RuntimeNextViewportEvent) => void
  readonly setPendingDataIntent: (intent: PendingDataIntent) => void
  readonly emitNeedForPendingIntent: (intent: PendingDataIntent) => void
}

export function reconcileBottomLockFromScroll<TMessage, TOptimistic>(
  deps: RuntimeInputHelperDeps<TMessage, TOptimistic>,
  scrollState: ScrollInteractionState,
): void {
  reconcileBottomLockFromMetrics(deps, scrollState)
}

export function reconcileBottomLockFromMetrics<TMessage, TOptimistic>(
  deps: RuntimeInputHelperDeps<TMessage, TOptimistic>,
  scrollState: ScrollInteractionState,
): void {
  const data = deps.data.getSnapshot()
  const segment = deps.revision.getCommittedSegment()
  const metrics = deps.metrics.getMetrics()
  const next = resolveBottomLockState({
    data,
    segment,
    metrics,
    hasSegmentShiftInFlight: scrollState.isSegmentShiftInFlight(),
  })
  if (deps.projection.getSnapshot().bottomLockState === next) return
  deps.setBottomLockState(next)
  deps.projection.patchState({ bottomLockState: next })
}

export function emitAdjacentPrefetchNeed<TMessage, TOptimistic>(
  deps: RuntimeInputHelperDeps<TMessage, TOptimistic>,
  edgeNeedLatch: EdgeNeedLatch,
): void {
  const snapshot = deps.data.getSnapshot()
  if (snapshot === null) return
  const metrics = deps.metrics.getMetrics()
  const request = resolveEdgeNeedRequest({ snapshot, metrics })
  if (request === null) return
  if (!edgeNeedLatch.shouldEmit({
    feedId: deps.feedId,
    generation: deps.generation,
    dataRevision: snapshot.revision,
    metrics,
    direction: request.direction,
  })) return

  if (request.direction === 'before') {
    deps.metrics.patchFlags({ adjacentPrefetchBefore: 'needed' })
    deps.emitEvent({
      type: 'needMoreBefore',
      feedId: deps.feedId,
      generation: deps.generation,
      reason: 'near-top',
    })
    return
  }

  deps.metrics.patchFlags({ adjacentPrefetchAfter: 'needed' })
  deps.emitEvent({
    type: 'needMoreAfter',
    feedId: deps.feedId,
    generation: deps.generation,
    reason: 'near-bottom',
  })
}

export function syncAdjacentPrefetchState<TMessage, TOptimistic>(
  deps: RuntimeInputHelperDeps<TMessage, TOptimistic>,
): void {
  const snapshot = deps.data.getSnapshot()
  const segment = deps.revision.getCommittedSegment()
  const metrics = deps.metrics.getMetrics()
  if (snapshot === null || segment === null || metrics.physicalSegmentId === null) {
    return
  }
  const { adjacentPrefetchBefore: before, adjacentPrefetchAfter: after } =
    resolveAdjacentPrefetchFlags({ snapshot, segment, previousMetrics: metrics })

  if (
    before !== metrics.adjacentPrefetchBefore ||
    after !== metrics.adjacentPrefetchAfter
  ) {
    deps.metrics.patchFlags({
      adjacentPrefetchBefore: before,
      adjacentPrefetchAfter: after,
    })
  }
}

export function resolveAdjacentPrefetchFlags<TMessage, TOptimistic>(input: {
  readonly snapshot: MessageDataSnapshot<TMessage, TOptimistic>
  readonly segment: PhysicalSegment
  readonly previousMetrics?: Pick<
    PhysicalScrollMetrics,
    | 'physicalSegmentId'
    | 'adjacentPrefetchBefore'
    | 'adjacentPrefetchAfter'
  >
}): Pick<
  PhysicalScrollMetrics,
  'adjacentPrefetchBefore' | 'adjacentPrefetchAfter'
> {
  return {
    adjacentPrefetchBefore: resolveAdjacentPrefetchDirection(
      input,
      'before',
    ),
    adjacentPrefetchAfter: resolveAdjacentPrefetchDirection(
      input,
      'after',
    ),
  }
}

function resolveAdjacentPrefetchDirection<TMessage, TOptimistic>(
  input: {
    readonly snapshot: MessageDataSnapshot<TMessage, TOptimistic>
    readonly segment: PhysicalSegment
    readonly previousMetrics?: Pick<
      PhysicalScrollMetrics,
      | 'physicalSegmentId'
      | 'adjacentPrefetchBefore'
      | 'adjacentPrefetchAfter'
    >
  },
  direction: 'before' | 'after',
): AdjacentPrefetchState {
  if (hasAdjacentSegmentData(input.snapshot, input.segment, direction)) {
    return 'ready'
  }
  if (direction === 'before' && !input.snapshot.hasMoreBefore) return 'idle'
  if (direction === 'after' && !input.snapshot.hasMoreAfter) return 'idle'

  const previous = input.previousMetrics
  if (previous?.physicalSegmentId === input.segment.segmentId) {
    return direction === 'before'
      ? previous.adjacentPrefetchBefore
      : previous.adjacentPrefetchAfter
  }

  return 'idle'
}
