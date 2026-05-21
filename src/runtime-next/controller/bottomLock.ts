import type { MessageDataSnapshot } from '../data/types'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import type { PhysicalScrollMetrics } from '../geometry/types'
import type { BottomLockState } from '../projection/types'

export type BottomLockResolutionInput = {
  readonly data: MessageDataSnapshot | null
  readonly segment: Pick<PhysicalSegment, 'logicalRole'> | null
  readonly metrics: Pick<
    PhysicalScrollMetrics,
    'maxScrollPosition' | 'scrollPosition'
  >
  readonly hasSegmentShiftInFlight: boolean
  readonly allowLock?: boolean
}

export function resolveBottomLockState(
  input: BottomLockResolutionInput,
): BottomLockState {
  if (input.allowLock === false) return 'UNLOCKED'
  if (input.data === null) return 'UNLOCKED'
  if (
    input.segment?.logicalRole !== 'latest' &&
    input.segment?.logicalRole !== 'short-feed'
  ) {
    return 'UNLOCKED'
  }
  if (input.data.hasMoreAfter) return 'UNLOCKED'
  if (input.hasSegmentShiftInFlight) return 'UNLOCKED'

  return Math.max(
    0,
    input.metrics.maxScrollPosition - input.metrics.scrollPosition,
  ) <= 16
    ? 'LOCKED'
    : 'UNLOCKED'
}
