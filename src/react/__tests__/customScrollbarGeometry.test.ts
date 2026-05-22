import { describe, expect, it } from 'vitest'
import {
  computeCustomScrollbarGeometry,
  getScrollbarPointerOverflowDirection,
  getScrollbarTrackPageScrollTop,
  getScrollTopForScrollbarPointer,
} from '../scrollbar/customScrollbarGeometry'

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

  it('maps pointer drag position back to scrollTop', () => {
    const geometry = computeCustomScrollbarGeometry({
      scrollTop: 0,
      scrollHeight: 1200,
      clientHeight: 240,
    })

    const scrollTop = getScrollTopForScrollbarPointer({
      pointerY: 100,
      trackTop: 10,
      grabOffset: 8,
      geometry,
      fallbackScrollTop: 50,
    })

    expect(scrollTop).toBeCloseTo(403.45, 2)
  })

  it('keeps pointer drag bounded by the track', () => {
    const geometry = computeCustomScrollbarGeometry({
      scrollTop: 0,
      scrollHeight: 1200,
      clientHeight: 240,
    })

    expect(
      getScrollTopForScrollbarPointer({
        pointerY: -100,
        trackTop: 0,
        grabOffset: 0,
        geometry,
        fallbackScrollTop: 50,
      }),
    ).toBe(0)
    expect(
      getScrollTopForScrollbarPointer({
        pointerY: 999,
        trackTop: 0,
        grabOffset: 0,
        geometry,
        fallbackScrollTop: 50,
      }),
    ).toBe(geometry.maxScrollTop)
  })

  it('detects pointer overflow outside active thumb travel', () => {
    const geometry = computeCustomScrollbarGeometry({
      scrollTop: 0,
      scrollHeight: 1200,
      clientHeight: 240,
    })

    expect(getScrollbarPointerOverflowDirection(0, 0, geometry)).toBe('before')
    expect(getScrollbarPointerOverflowDirection(300, 0, geometry)).toBe('after')
    expect(getScrollbarPointerOverflowDirection(20, 0, geometry)).toBeNull()
  })

  it('maps track clicks to bounded page jumps', () => {
    const geometry = computeCustomScrollbarGeometry({
      scrollTop: 480,
      scrollHeight: 1200,
      clientHeight: 240,
    })

    expect(
      getScrollbarTrackPageScrollTop({
        clickY: geometry.thumbTop - 1,
        scrollTop: 480,
        clientHeight: 240,
        geometry,
      }),
    ).toBe(272)
    expect(
      getScrollbarTrackPageScrollTop({
        clickY: geometry.thumbTop + geometry.thumbLength + 1,
        scrollTop: 480,
        clientHeight: 240,
        geometry,
      }),
    ).toBe(688)
  })
})
