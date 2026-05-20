import type { ViewportModifier } from './types'

const supportedViewportModifiers: ReadonlySet<string> = new Set([
  'none',
  'prepend',
  'append',
  'items-change',
  'auto-scroll-to-bottom',
  'reset',
])

export function assertSupportedViewportModifier(
  modifier: string,
): asserts modifier is ViewportModifier {
  if (supportedViewportModifiers.has(modifier)) {
    return
  }

  // 未进入合同表的 modifier 视为 reserved，runtime-next 不能静默吞掉未定义几何语义。
  throw new Error(
    `runtime-next viewport modifier is not implemented: ${modifier}`,
  )
}
