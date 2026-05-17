import { describe, expect, it } from 'vitest'
import { computeCustomScrollbarGeometry } from '../customScrollbarGeometry'

describe('computeCustomScrollbarGeometry', () => {
  it('hides when content does not overflow', () => {
    expect(
      computeCustomScrollbarGeometry({
        scrollTop: 0,
        scrollHeight: 240,
        clientHeight: 240,
      }),
    ).toEqual(
      expect.objectContaining({
        scrollable: false,
        thumbLength: 0,
      }),
    )
  })

  it('maps scroll position to a bounded thumb', () => {
    const geometry = computeCustomScrollbarGeometry({
      scrollTop: 300,
      scrollHeight: 1200,
      clientHeight: 240,
    })

    expect(geometry.scrollable).toBe(true)
    expect(geometry.thumbLength).toBeGreaterThanOrEqual(32)
    expect(geometry.thumbTop).toBeGreaterThan(4)
    expect(geometry.thumbTop + geometry.thumbLength).toBeLessThanOrEqual(236)
  })

  it('clamps the thumb to the track at bottom', () => {
    const geometry = computeCustomScrollbarGeometry({
      scrollTop: 960,
      scrollHeight: 1200,
      clientHeight: 240,
    })

    expect(geometry.thumbTop + geometry.thumbLength).toBeCloseTo(236, 5)
  })
})
