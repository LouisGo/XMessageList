import { describe, expect, it } from 'vitest'
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
})
