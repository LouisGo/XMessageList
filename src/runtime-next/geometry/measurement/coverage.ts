import type {
  PhysicalCoverageInput,
  PhysicalCoverageResult,
  SafeScrollRange,
  SafeScrollRangeInput,
} from './coverage.types'

export function computeSafeScrollRange(
  input: SafeScrollRangeInput,
): SafeScrollRange {
  const topSpacer = toNonNegativeFinitePx(input.topSpacer)
  const mountedRowsHeight = toNonNegativeFinitePx(input.mountedRowsHeight)
  const clientHeight = toNonNegativeFinitePx(input.clientHeight)
  const realRowStartPx = topSpacer
  const realRowEndPx = topSpacer + mountedRowsHeight
  const safeScrollRangeStart = realRowStartPx
  const safeScrollRangeEnd = Math.max(
    safeScrollRangeStart,
    realRowEndPx - clientHeight,
  )

  return {
    realRowStartPx,
    realRowEndPx,
    safeScrollRangeStart,
    safeScrollRangeEnd,
  }
}

export function computeRealRowCoverage(
  input: PhysicalCoverageInput,
): PhysicalCoverageResult {
  const topSpacer = toNonNegativeFinitePx(input.topSpacer)
  const mountedRowsHeight = toNonNegativeFinitePx(input.mountedRowsHeight)
  const clientHeight = toNonNegativeFinitePx(input.clientHeight)
  const scrollTop = toNonNegativeFinitePx(input.scrollTop)
  const minRealRowCoveragePx = toNonNegativeFinitePx(
    input.minRealRowCoveragePx ?? clientHeight,
  )
  const range = computeSafeScrollRange({
    topSpacer,
    mountedRowsHeight,
    clientHeight,
  })
  const viewportStartPx = scrollTop
  const viewportEndPx = viewportStartPx + clientHeight
  const realRowCoveragePx = computeIntervalOverlapPx({
    start: viewportStartPx,
    end: viewportEndPx,
  }, {
    start: range.realRowStartPx,
    end: range.realRowEndPx,
  })
  const requiredRealRowCoveragePx = Math.min(
    clientHeight,
    minRealRowCoveragePx,
  )
  const isShortFeed = mountedRowsHeight < clientHeight
  const isWithinSafeScrollRange =
    !isShortFeed &&
    scrollTop >= range.safeScrollRangeStart &&
    scrollTop <= range.safeScrollRangeEnd
  const hasMountedRows = mountedRowsHeight > 0
  const isSpacerOnlyViewport =
    clientHeight > 0 &&
    hasMountedRows &&
    realRowCoveragePx === 0

  return {
    ...range,
    viewportStartPx,
    viewportEndPx,
    realRowCoveragePx,
    minRealRowCoveragePx,
    requiredRealRowCoveragePx,
    isShortFeed,
    isWithinSafeScrollRange,
    isSpacerOnlyViewport,
    isRealRowCoverageInsufficient:
      !isShortFeed &&
      requiredRealRowCoveragePx > 0 &&
      realRowCoveragePx < requiredRealRowCoveragePx,
  }
}

function computeIntervalOverlapPx(
  a: { readonly start: number; readonly end: number },
  b: { readonly start: number; readonly end: number },
): number {
  const start = Math.max(a.start, b.start)
  const end = Math.min(a.end, b.end)

  return Math.max(0, end - start)
}

function toNonNegativeFinitePx(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}
