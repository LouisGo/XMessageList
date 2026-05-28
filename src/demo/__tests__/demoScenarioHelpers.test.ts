import { describe, expect, it } from 'vitest'

import { getMockDelayMs } from '../scenario/demoScenarioHelpers'

describe('demoScenarioHelpers', () => {
  it('jitters mock delays within +/-50 percent of the base', () => {
    expect(getMockDelayMs(100, () => 0)).toBe(50)
    expect(getMockDelayMs(100, () => 1)).toBe(150)
  })
})
