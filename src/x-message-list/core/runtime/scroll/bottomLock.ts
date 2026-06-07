import type { RuntimeMeasurement } from '../dom/measurement'
import type { BottomLockState, MessageListSnapshot } from '../contracts/snapshot'

// 从真实 DOM 距底状态推导 lock，只用于观测/校准；仍有 after 数据时不能声明源底部 locked。
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
