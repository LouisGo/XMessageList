import { describe, expect, it } from 'vitest'
import {
  computeRealRowCoverage,
  computeSafeScrollRange,
} from './coverage'

describe('physical geometry coverage', () => {
  it('computes the safe scroll range from the real row interval', () => {
    expect(
      computeSafeScrollRange({
        topSpacer: 120,
        mountedRowsHeight: 800,
        clientHeight: 300,
      }),
    ).toEqual({
      realRowStartPx: 120,
      realRowEndPx: 920,
      safeScrollRangeStart: 120,
      safeScrollRangeEnd: 620,
    })
  })

  it('computes real row coverage for the current viewport interval', () => {
    const coverage = computeRealRowCoverage({
      topSpacer: 100,
      mountedRowsHeight: 600,
      clientHeight: 300,
      scrollTop: 50,
    })

    expect(coverage.viewportStartPx).toBe(50)
    expect(coverage.viewportEndPx).toBe(350)
    expect(coverage.realRowCoveragePx).toBe(250)
    expect(coverage.isWithinSafeScrollRange).toBe(false)
    expect(coverage.isRealRowCoverageInsufficient).toBe(true)
    expect(coverage.isSpacerOnlyViewport).toBe(false)
  })

  it('treats mounted content shorter than the viewport as short-feed semantics', () => {
    const coverage = computeRealRowCoverage({
      topSpacer: 0,
      mountedRowsHeight: 180,
      clientHeight: 400,
      scrollTop: 0,
    })

    expect(coverage.safeScrollRangeStart).toBe(0)
    expect(coverage.safeScrollRangeEnd).toBe(0)
    expect(coverage.realRowCoveragePx).toBe(180)
    expect(coverage.isShortFeed).toBe(true)
    expect(coverage.isRealRowCoverageInsufficient).toBe(false)
  })

  it('detects a viewport that contains only spacer above the mounted rows', () => {
    const coverage = computeRealRowCoverage({
      topSpacer: 500,
      mountedRowsHeight: 300,
      clientHeight: 200,
      scrollTop: 0,
    })

    expect(coverage.realRowCoveragePx).toBe(0)
    expect(coverage.isSpacerOnlyViewport).toBe(true)
    expect(coverage.isRealRowCoverageInsufficient).toBe(true)
  })

  it('detects insufficient real coverage when the viewport only grazes row edges', () => {
    const coverage = computeRealRowCoverage({
      topSpacer: 0,
      mountedRowsHeight: 500,
      clientHeight: 300,
      scrollTop: 450,
      minRealRowCoveragePx: 240,
    })

    expect(coverage.realRowCoveragePx).toBe(50)
    expect(coverage.requiredRealRowCoveragePx).toBe(240)
    expect(coverage.isSpacerOnlyViewport).toBe(false)
    expect(coverage.isRealRowCoverageInsufficient).toBe(true)
  })
})
