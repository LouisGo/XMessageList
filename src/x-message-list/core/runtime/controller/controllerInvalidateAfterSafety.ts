import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { RuntimeMeasurement } from '../dom/measurement'

export type InvalidateAfterSafety =
  | 'safe'
  | 'runtime-busy'
  | 'visible-range-overlap'

/**
 * invalidateAfter 的原子安全证明：状态在 DOM 读取前后各检查一次，避免 IDLE
 * snapshot listener 或 native-scroll rAF 窗口造成 TOCTOU。
 */
export function probeInvalidateAfterSafety(input: {
  suffixKeys: MessageRuntimeItemKey[]
  isRuntimeBusy(): boolean
  measureSuffix(keys: MessageRuntimeItemKey[]): RuntimeMeasurement
}): InvalidateAfterSafety {
  if (input.isRuntimeBusy()) return 'runtime-busy'
  const measurement = input.measureSuffix(input.suffixKeys)
  const overlaps = measurement.visibleRows.some((row) =>
    row.bottom > measurement.viewportTop + 1 &&
    row.top < measurement.viewportBottom - 1
  )
  if (input.isRuntimeBusy()) return 'runtime-busy'
  return overlaps ? 'visible-range-overlap' : 'safe'
}
