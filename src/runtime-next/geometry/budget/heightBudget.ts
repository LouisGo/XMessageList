import {
  DEFAULT_PHYSICAL_SEGMENT_CONFIG,
  resolvePhysicalSegmentConfig,
} from '../config/config'
import type { PhysicalSegmentConfig } from '../config/config'
import type { PhysicalSegmentCapMode } from '../types'

export type PhysicalHeightBudgetInputBase = {
  readonly clientHeight: number
  readonly mountedRowsHeight?: number
  readonly config?: PhysicalSegmentConfig
}

export type NormalPhysicalHeightBudgetInput =
  PhysicalHeightBudgetInputBase & {
    readonly isShortFeed?: false
  }

export type ShortFeedPhysicalHeightBudgetInput =
  PhysicalHeightBudgetInputBase & {
    readonly isShortFeed: true
    readonly shortFeedContentHeight: number
  }

export type PhysicalHeightBudgetInput =
  | NormalPhysicalHeightBudgetInput
  | ShortFeedPhysicalHeightBudgetInput

export type ScrollHeightCapInput = {
  readonly clientHeight: number
  readonly config?: PhysicalSegmentConfig
}

export type PhysicalHeightBudget = {
  readonly physicalWindowHeight: number
  readonly scrollHeightCap: number
  readonly capMode: PhysicalSegmentCapMode
}

export function computeScrollHeightCap(
  input: ScrollHeightCapInput,
): number {
  const config = resolvePhysicalSegmentConfig(input.config)
  const clientHeight = assertHeight(input.clientHeight, 'clientHeight')
  const maxPhysicalScrollHeightPx =
    config.maxPhysicalScrollHeightPx ??
    Number.POSITIVE_INFINITY
  const maxPhysicalViewportMultiplier =
    config.maxPhysicalViewportMultiplier ??
    DEFAULT_PHYSICAL_SEGMENT_CONFIG.maxPhysicalViewportMultiplier

  return Math.max(
    clientHeight,
    Math.min(
      maxPhysicalScrollHeightPx,
      clientHeight * maxPhysicalViewportMultiplier,
    ),
  )
}

// 只在 build/relayout 阶段计算 committed 高度；measurement delta 不能补丁式改当前 revision。
export function computePhysicalHeightBudget(
  input: PhysicalHeightBudgetInput,
): PhysicalHeightBudget {
  const config = resolvePhysicalSegmentConfig(input.config)
  const clientHeight = assertHeight(input.clientHeight, 'clientHeight')
  const mountedRowsHeight = assertHeight(
    input.mountedRowsHeight ?? 0,
    'mountedRowsHeight',
  )
  const scrollHeightCap = computeScrollHeightCap({
    clientHeight,
    config,
  })
  const minimumSafeBufferPx =
    config.minimumSafeBufferPx ??
    DEFAULT_PHYSICAL_SEGMENT_CONFIG.minimumSafeBufferPx
  const exceptionalRowHeight =
    mountedRowsHeight + minimumSafeBufferPx

  if (exceptionalRowHeight > scrollHeightCap) {
    return createBudget({
      physicalWindowHeight: Math.max(
        scrollHeightCap,
        exceptionalRowHeight,
      ),
      scrollHeightCap,
      capMode: 'exceptional-row',
    })
  }

  if (input.isShortFeed === true) {
    return createBudget({
      physicalWindowHeight: Math.max(
        clientHeight,
        assertHeight(
          input.shortFeedContentHeight,
          'shortFeedContentHeight',
        ),
      ),
      scrollHeightCap,
      capMode: 'short-feed',
    })
  }

  return createBudget({
    physicalWindowHeight: scrollHeightCap,
    scrollHeightCap,
    capMode: 'normal',
  })
}

function createBudget(input: PhysicalHeightBudget): PhysicalHeightBudget {
  return input
}

function assertHeight(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${fieldName} must be a finite non-negative number`,
    )
  }

  return value
}
