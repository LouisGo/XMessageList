import { describe, expect, it } from 'vitest'
import {
  computePhysicalHeightBudget,
  computeScrollHeightCap,
} from './heightBudget'

describe('physical height budget', () => {
  it('uses the normal scroll height cap as the fixed physical window height', () => {
    const budget = computePhysicalHeightBudget({
      clientHeight: 800,
      mountedRowsHeight: 1800,
      config: {
        maxPhysicalScrollHeightPx: 10000,
        maxPhysicalViewportMultiplier: 4,
        minimumSafeBufferPx: 160,
      },
    })

    expect(budget).toEqual({
      physicalWindowHeight: 3200,
      scrollHeightCap: 3200,
      capMode: 'normal',
    })
  })

  it('keeps the viewport height as the minimum scroll height cap', () => {
    expect(
      computeScrollHeightCap({
        clientHeight: 1200,
        config: {
          maxPhysicalScrollHeightPx: 500,
          maxPhysicalViewportMultiplier: 0.25,
        },
      }),
    ).toBe(1200)
  })

  it('keeps short feeds sized to real content instead of manufacturing cap space', () => {
    const budget = computePhysicalHeightBudget({
      clientHeight: 720,
      mountedRowsHeight: 900,
      isShortFeed: true,
      shortFeedContentHeight: 960,
      config: {
        maxPhysicalScrollHeightPx: 16000,
        maxPhysicalViewportMultiplier: 5,
      },
    })

    expect(budget).toEqual({
      physicalWindowHeight: 960,
      scrollHeightCap: 3600,
      capMode: 'short-feed',
    })

    expect(
      computePhysicalHeightBudget({
        clientHeight: 720,
        mountedRowsHeight: 320,
        isShortFeed: true,
        shortFeedContentHeight: 320,
      }).physicalWindowHeight,
    ).toBe(720)
  })

  it('falls back to exceptional-row cap when mounted rows need more than the normal cap', () => {
    const budget = computePhysicalHeightBudget({
      clientHeight: 1000,
      mountedRowsHeight: 2950,
      config: {
        maxPhysicalScrollHeightPx: 3000,
        maxPhysicalViewportMultiplier: 3,
        minimumSafeBufferPx: 200,
      },
    })

    expect(budget).toEqual({
      physicalWindowHeight: 3150,
      scrollHeightCap: 3000,
      capMode: 'exceptional-row',
    })
  })

  it('does not derive height from DataWindow length', () => {
    const baseInput = {
      clientHeight: 640,
      mountedRowsHeight: 1200,
      config: {
        maxPhysicalScrollHeightPx: 16000,
        maxPhysicalViewportMultiplier: 4,
        minimumSafeBufferPx: 160,
      },
    }
    const shortDataWindowInput = {
      ...baseInput,
      dataWindowLength: 12,
    }
    const longDataWindowInput = {
      ...baseInput,
      dataWindowLength: 12000,
    }

    expect(computePhysicalHeightBudget(shortDataWindowInput)).toEqual(
      computePhysicalHeightBudget(longDataWindowInput),
    )
  })

  it('treats later measurements as a new build-time computation without mutating prior output', () => {
    const committedBudget = computePhysicalHeightBudget({
      clientHeight: 800,
      mountedRowsHeight: 1600,
      config: {
        maxPhysicalScrollHeightPx: 3200,
        maxPhysicalViewportMultiplier: 4,
        minimumSafeBufferPx: 160,
      },
    })

    const relayoutBudget = computePhysicalHeightBudget({
      clientHeight: 800,
      mountedRowsHeight: 3300,
      config: {
        maxPhysicalScrollHeightPx: 3200,
        maxPhysicalViewportMultiplier: 4,
        minimumSafeBufferPx: 160,
      },
    })

    expect(committedBudget).toEqual({
      physicalWindowHeight: 3200,
      scrollHeightCap: 3200,
      capMode: 'normal',
    })
    expect(relayoutBudget).toEqual({
      physicalWindowHeight: 3460,
      scrollHeightCap: 3200,
      capMode: 'exceptional-row',
    })
  })
})
