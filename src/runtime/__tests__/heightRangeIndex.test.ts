import { describe, expect, it, vi } from 'vitest'
import { SpacerEngine } from '../window/spacerEngine'
import type { MessageDataItem } from '..'

function createItems(count: number): MessageDataItem[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'committed' as const,
    key: { kind: 'committed' as const, messageId: `m-${index}` },
    message: { id: `m-${index}` },
    version: 1,
    estimatedHeight: 10 + index,
  }))
}

describe('HeightRangeIndex', () => {
  it('serves repeated spacer range estimates from one snapshot-width index', () => {
    const items = createItems(100)
    const spacer = new SpacerEngine(new Map())

    spacer.setRangeCacheIdentity('feed:1:1')

    expect(spacer.estimateRangeHeight(items, 0, 10, 320)).toBe(145)
    expect(spacer.estimateRangeHeight(items, 10, 20, 320)).toBe(245)
    expect(spacer.findEstimatedIndexAtOffset(items, 145, 320)).toBe(9)
  })

  it('rebuilds when measured height estimates are invalidated', () => {
    const items = createItems(10)
    const heightCache = new Map()
    const spacer = new SpacerEngine(heightCache)

    spacer.setRangeCacheIdentity('feed:1:1')
    expect(spacer.estimateRangeHeight(items, 0, 2, 320)).toBe(21)

    heightCache.set('committed:m-0', {
      height: 100,
      measuredAtRevision: 2,
      contentVersion: 1,
      widthBucket: 10,
      lastAccessedAt: 0,
    })
    spacer.invalidateEstimateCache()
    spacer.setRangeCacheIdentity('feed:1:2')

    expect(spacer.estimateRangeHeight(items, 0, 2, 320)).toBe(111)
  })

  it('rebuilds derived ranges when the data revision identity changes', () => {
    const items = createItems(100)
    const spacer = new SpacerEngine(new Map())
    const estimateItemHeight = vi.spyOn(spacer, 'estimateItemHeight')

    spacer.setRangeCacheIdentity('feed:1:1')
    spacer.estimateRangeHeight(items, 0, 20, 320)
    expect(estimateItemHeight).toHaveBeenCalledTimes(items.length)

    spacer.setRangeCacheIdentity('feed:1:2')
    spacer.estimateRangeHeight(items, 0, 20, 320)
    expect(estimateItemHeight).toHaveBeenCalledTimes(items.length * 2)
  })

  it('keeps repeated 20k item range and offset queries to one index build', () => {
    const items = createItems(20_000)
    const spacer = new SpacerEngine(new Map())
    const estimateItemHeight = vi.spyOn(spacer, 'estimateItemHeight')

    spacer.setRangeCacheIdentity('feed:1:large')

    expect(spacer.estimateRangeHeight(items, 0, 5_000, 320)).toBeGreaterThan(0)
    expect(estimateItemHeight).toHaveBeenCalledTimes(items.length)

    for (let index = 0; index < 100; index += 1) {
      const start = index * 50
      spacer.estimateRangeHeight(items, start, start + 1_000, 320)
      spacer.findEstimatedIndexAtOffset(items, index * 2_500, 320)
    }

    expect(estimateItemHeight).toHaveBeenCalledTimes(items.length)
  })
})
