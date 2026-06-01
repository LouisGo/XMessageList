import type { MessageIdentityAnchor } from '../contracts/identity'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { DestinationIntent } from '../interactions/interactionState'
import type { ControllerMotionCoordinator } from './controllerMotionCoordinator'
import type { PendingRuntimeMotion } from './controllerTransactionHelpers'

type PendingRuntimeMotionCallbacks<TMessage, TOptimistic> = {
  motion: ControllerMotionCoordinator<TMessage, TOptimistic>
  setViewportPhase(phase: MessageListSnapshot['viewportPhase']): void
  emitViewportObservation(
    reason: 'transaction-settle',
    scrollSource: PendingRuntimeMotion<TMessage, TOptimistic>['scrollSource'],
    anchor: MessageIdentityAnchor | null,
  ): void
  emitAnchorChanged(
    reason: 'transaction-settle',
    anchor: MessageIdentityAnchor | null,
  ): void
  emitDestinationSettled(
    destination: DestinationIntent,
    anchor: MessageIdentityAnchor | null,
  ): void
  emitSegmentTrimPressure(
    segment: LoadedSegment<TMessage, TOptimistic>,
    anchor: MessageIdentityAnchor | null,
  ): void
}

export function startPendingRuntimeMotion<TMessage, TOptimistic>(
  pendingMotion: PendingRuntimeMotion<TMessage, TOptimistic> | null,
  callbacks: PendingRuntimeMotionCallbacks<TMessage, TOptimistic>,
): boolean {
  if (!pendingMotion) {
    return false
  }

  if (
    callbacks.motion.startResolution(
      pendingMotion.settlement,
      pendingMotion.scrollSource,
    )
  ) {
    callbacks.emitSegmentTrimPressure(
      pendingMotion.segment,
      pendingMotion.settlement.anchor,
    )
    return true
  }

  callbacks.setViewportPhase('IDLE')
  callbacks.emitViewportObservation(
    'transaction-settle',
    pendingMotion.scrollSource,
    pendingMotion.settlement.anchor,
  )
  callbacks.emitAnchorChanged(
    'transaction-settle',
    pendingMotion.settlement.anchor,
  )
  if (pendingMotion.settlement.destination) {
    callbacks.emitDestinationSettled(
      pendingMotion.settlement.destination,
      pendingMotion.settlement.anchor,
    )
  }
  callbacks.emitSegmentTrimPressure(
    pendingMotion.segment,
    pendingMotion.settlement.anchor,
  )
  return false
}
