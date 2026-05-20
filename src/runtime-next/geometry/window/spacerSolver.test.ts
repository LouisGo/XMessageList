import { describe, expect, it } from 'vitest'
import { solveLocalSpacers } from './spacerSolver'

describe('local spacer solver', () => {
  it('conserves physical height in normal mode', () => {
    const plan = solveLocalSpacers({
      physicalWindowHeight: 800,
      mountedRowsHeightEstimate: 500,
      placement: 'center',
    })

    expect(plan.topSpacer).toBe(150)
    expect(plan.bottomSpacer).toBe(150)
    expect(
      plan.topSpacer +
        plan.mountedRowsHeightEstimate +
        plan.bottomSpacer,
    ).toBe(plan.physicalWindowHeight)
    expect(plan.naturalBlankHeight).toBe(0)
  })

  it('keeps latest-style rows pinned to the physical bottom', () => {
    const plan = solveLocalSpacers({
      physicalWindowHeight: 720,
      mountedRowsHeightEstimate: 600,
      placement: 'end',
    })

    expect(plan.topSpacer).toBe(120)
    expect(plan.bottomSpacer).toBe(0)
    expect(plan.topSpacer + plan.mountedRowsHeightEstimate).toBe(720)
  })

  it('exposes short-feed natural blank outside top and bottom spacers', () => {
    const plan = solveLocalSpacers({
      physicalWindowHeight: 600,
      mountedRowsHeightEstimate: 260,
      capMode: 'short-feed',
      placement: 'end',
    })

    expect(plan.topSpacer).toBe(0)
    expect(plan.bottomSpacer).toBe(0)
    expect(plan.naturalBlankHeight).toBe(340)
    expect(
      plan.mountedRowsHeightEstimate + plan.naturalBlankHeight,
    ).toBe(plan.physicalWindowHeight)
  })

  it('rejects an impossible negative physical budget', () => {
    expect(() =>
      solveLocalSpacers({
        physicalWindowHeight: -1,
        mountedRowsHeightEstimate: 100,
      }),
    ).toThrow(/physicalWindowHeight/)
  })

  it('rejects mounted rows that cannot fit without negative spacers', () => {
    expect(() =>
      solveLocalSpacers({
        physicalWindowHeight: 400,
        mountedRowsHeightEstimate: 401,
      }),
    ).toThrow(/exceed physicalWindowHeight/)
  })
})
