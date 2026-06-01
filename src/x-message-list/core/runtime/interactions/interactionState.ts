import { DestinationCoordinator } from './destinationCoordinator'
import { EdgeNeedCoordinator } from './edgeNeedCoordinator'
import { FollowBottomCoordinator } from './followBottomCoordinator'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import { UnderflowCoordinator } from './underflowCoordinator'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'
import type {
  DestinationIntent,
  EdgeNeedOptions,
  InteractionUpdate,
  RuntimeEdge,
  UnderflowInput,
} from '../state/interactionTypes'

export type {
  DestinationIntent,
  EdgeNeedOptions,
  InteractionUpdate,
  RuntimeEdge,
  UnderflowInput,
} from '../state/interactionTypes'

/**
 * RuntimeInteractionState 只仲裁 pending intent 和 edge/follow/destination/underflow 状态，不直接读写 DOM。
 */
export class RuntimeInteractionState<TMessage, TOptimistic> {
  private requestSequence = 0

  private readonly edge: EdgeNeedCoordinator<TMessage, TOptimistic>

  private readonly followBottom: FollowBottomCoordinator<TMessage, TOptimistic>

  private readonly destination: DestinationCoordinator<TMessage, TOptimistic>

  private readonly underflow: UnderflowCoordinator<TMessage, TOptimistic>

  constructor(
    private readonly axes: RuntimeStateAxes,
    underflowTolerancePx = 2,
    edgeActivationMarginPx?: number,
  ) {
    this.edge = new EdgeNeedCoordinator((kind) => this.nextRequestToken(kind))
    this.followBottom = new FollowBottomCoordinator(
      this.axes,
      (kind) => this.nextRequestToken(kind),
    )
    this.destination = new DestinationCoordinator(
      this.axes,
      (kind) => this.nextRequestToken(kind),
    )
    this.underflow = new UnderflowCoordinator(
      this.axes,
      underflowTolerancePx,
      edgeActivationMarginPx,
    )
  }

  resetForGeneration(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    this.followBottom.reset()
    this.destination.reset()
    this.underflow.reset()
    this.axes.resetIntentAxes()
    return {
      ...this.edge.reset(snapshot),
      pendingIntent: null,
      bottomLockState: 'UNLOCKED',
    }
  }

  getPendingDestination(): DestinationIntent | null {
    return this.destination.getPending()
  }

  markPendingDestinationResolvingDom(): void {
    this.destination.markResolvingDom()
  }

  markLocalDestinationSettled(): void {
    this.destination.markLocalSettled()
  }

  clearFollowBottom(): void {
    this.followBottom.clear()
  }

  cancelUnderflowFill(): void {
    this.underflow.reset()
  }

  startEdgeNeed(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    edge: RuntimeEdge,
    reason: string,
    pendingIntent: MessageListSnapshot['pendingIntent'],
    options: EdgeNeedOptions = {},
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    if (!pendingIntent) {
      return null
    }

    const update = this.edge.start(snapshot, edge, reason, pendingIntent, options)

    if (!update) {
      return null
    }

    if (pendingIntent === 'underflow-fill') {
      this.axes.markUnderflowPending()
    } else {
      this.axes.markEdgePending()
    }
    return update
  }

  retryEdge(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    edge: RuntimeEdge,
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    const update = this.edge.retry(snapshot, edge)

    if (update) {
      this.axes.markEdgePending()
    }

    return update
  }

  reportEdgeError(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    edge: RuntimeEdge,
    requestToken: string,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    const next = this.edge.reportError(snapshot, edge, requestToken)

    if (next !== snapshot) {
      this.axes.markReadyIdle()
    }

    return next
  }

  startFollowBottom(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    scrollTop = 0,
  ): InteractionUpdate<TMessage, TOptimistic> {
    this.destination.clear()
    return this.followBottom.start(snapshot, scrollTop)
  }

  startFollowBottomForLocalReset(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    scrollTop = 0,
  ): InteractionUpdate<TMessage, TOptimistic> {
    this.destination.clear()
    return this.followBottom.startForLocalReset(snapshot, scrollTop)
  }

  startDestination(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    intent: DestinationIntent,
  ): InteractionUpdate<TMessage, TOptimistic> {
    this.followBottom.clear()
    return this.destination.start(snapshot, intent)
  }

  settleSegment(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    segment: LoadedSegment<TMessage, TOptimistic>,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    let next = snapshot

    if (isSegmentReset(segment)) {
      next = this.edge.reset(next)
    }

    next = this.edge.settleSegment(next, segment)
    next = this.destination.settleSegment(next, segment)
    next = this.followBottom.settleSegment(next, segment)
    next = this.underflow.settlePending(next)

    if (!this.followBottom.hasActive(next)) {
      this.followBottom.reset()
    }

    if (
      !next.pendingIntent &&
      !this.axes.isReadySubstate(
        'READY_DESTINATION_PENDING',
        'READY_FOLLOW_BOTTOM_PENDING',
      )
    ) {
      this.axes.markReadyIdle()
    }

    return next
  }

  evaluateUnderflow(
    input: UnderflowInput<TMessage, TOptimistic>,
  ): InteractionUpdate<TMessage, TOptimistic> | null {
    return this.underflow.evaluate(
      input,
      (edge, reason) => this.edge.start(
        input.snapshot,
        edge,
        reason,
        'underflow-fill',
        { ignoreScrollSource: true },
      ),
      this.destination.getLastDirection(),
    )
  }

  hasActiveFollowBottom(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): boolean {
    return this.followBottom.hasActive(snapshot)
  }

  updateActiveFollowBottomForScroll(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    source: ScrollSource,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    return this.followBottom.updateForScroll(snapshot, scrollTop, source)
  }

  private nextRequestToken(feedIdOrKind: string): string {
    this.requestSequence += 1
    return `${feedIdOrKind}:${this.requestSequence}`
  }
}

function isSegmentReset<TMessage, TOptimistic>(
  segment: LoadedSegment<TMessage, TOptimistic>,
): boolean {
  return segment.modifier.type === 'bootstrap' ||
    segment.modifier.type === 'reset-around' ||
    segment.modifier.type === 'reset-latest'
}
