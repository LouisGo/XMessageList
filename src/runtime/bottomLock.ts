import type { RuntimeMeasurement } from './measurement'
import type { BottomLockState, MessageListSnapshot } from './snapshot'

export function resolveObservedBottomLockState<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  measurement: RuntimeMeasurement,
): BottomLockState {
  const atNativeBottom = Math.abs(
    measurement.scrollHeight -
      measurement.clientHeight -
      measurement.scrollTop,
  ) <= 2

  return atNativeBottom && !snapshot.segmentMeta.hasMoreAfter
    ? 'LOCKED'
    : 'UNLOCKED'
}
