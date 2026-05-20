export type PhysicalCoverageInput = {
  readonly topSpacer: number
  readonly mountedRowsHeight: number
  readonly clientHeight: number
  readonly scrollTop: number
  readonly minRealRowCoveragePx?: number
}

export type SafeScrollRangeInput = Pick<
  PhysicalCoverageInput,
  'topSpacer' | 'mountedRowsHeight' | 'clientHeight'
>

export type SafeScrollRange = {
  readonly realRowStartPx: number
  readonly realRowEndPx: number
  readonly safeScrollRangeStart: number
  readonly safeScrollRangeEnd: number
}

export type PhysicalCoverageResult = SafeScrollRange & {
  readonly viewportStartPx: number
  readonly viewportEndPx: number
  readonly realRowCoveragePx: number
  readonly minRealRowCoveragePx: number
  readonly requiredRealRowCoveragePx: number
  readonly isShortFeed: boolean
  readonly isWithinSafeScrollRange: boolean
  readonly isSpacerOnlyViewport: boolean
  readonly isRealRowCoverageInsufficient: boolean
}
