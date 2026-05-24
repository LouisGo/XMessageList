import { describe, expect, it, vi } from 'vitest'
import { RenderWindowEngine } from '../window/renderWindowEngine'
import { SpacerEngine } from '../window/spacerEngine'
import type { MessageDataItem } from '..'

function createItems(count: number): MessageDataItem[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'committed' as const,
    key: { kind: 'committed' as const, messageId: `m-${index}` },
    message: { id: `m-${index}` },
    version: 1,
    estimatedHeight: 10,
  }))
}

describe('RenderWindowEngine', () => {
  it('delegates spacer-only offset lookup to the spacer range index', () => {
    const items = createItems(5_000)
    const spacer = {
      findEstimatedIndexAtOffset: vi.fn(() => 122),
    } as Pick<
      SpacerEngine,
      'findEstimatedIndexAtOffset'
    > as SpacerEngine
    const engine = new RenderWindowEngine(
      { overscan: 3, maxMountedItems: 200 },
      spacer,
    )

    expect(engine.findEstimatedIndexAtOffset(items, 1_230, 320)).toBe(122)
    expect(spacer.findEstimatedIndexAtOffset).toHaveBeenCalledWith(
      items,
      1_230,
      320,
    )
  })

  it('does not query spacer indexes for an empty item set', () => {
    const spacer = {
      findEstimatedIndexAtOffset: vi.fn(() => 0),
    } as Pick<
      SpacerEngine,
      'findEstimatedIndexAtOffset'
    > as SpacerEngine
    const engine = new RenderWindowEngine(
      { overscan: 3, maxMountedItems: 200 },
      spacer,
    )

    expect(engine.findEstimatedIndexAtOffset([], 250, 320)).toBe(-1)
    expect(spacer.findEstimatedIndexAtOffset).not.toHaveBeenCalled()
  })

  it('reuses the spacer range index for spacer and offset queries in one revision', () => {
    const items = createItems(20_000)
    const spacer = new SpacerEngine(new Map())
    const engine = new RenderWindowEngine(
      { overscan: 3, maxMountedItems: 200 },
      spacer,
    )
    const estimateItemHeight = vi.spyOn(spacer, 'estimateItemHeight')

    spacer.setRangeCacheIdentity('feed:1:1')
    spacer.estimateRangeHeight(items, 0, 5_000, 320)
    expect(estimateItemHeight).toHaveBeenCalledTimes(items.length)

    engine.findEstimatedIndexAtOffset(items, 50_000, 320)
    spacer.estimateRangeHeight(items, 5_000, 10_000, 320)

    expect(estimateItemHeight).toHaveBeenCalledTimes(items.length)
  })
})
