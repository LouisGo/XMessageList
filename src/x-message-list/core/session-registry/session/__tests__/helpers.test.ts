import { describe, expect, it } from 'vitest'
import { resolveAdaptiveTrimBudget } from '../helpers'

describe('resolveAdaptiveTrimBudget', () => {
  it('uses viewport evidence as the primary retention signal', () => {
    expect(resolveAdaptiveTrimBudget({
      pageSize: 20,
      retention: 'balanced',
      rowsPerViewportEstimate: 12,
    })).toBe(96)
  })

  it('does not trim below a two-page retained runway', () => {
    expect(resolveAdaptiveTrimBudget({
      pageSize: 32,
      retention: 'low',
      rowsPerViewportEstimate: 4,
    })).toBe(64)
  })
})
