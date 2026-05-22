import { describe, expect, it } from 'vitest'
import { RenderWindowEngine } from '../window/renderWindowEngine'
import type { SpacerEngine } from '../window/spacerEngine'
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
  it('reuses a prefix height index for repeated offset lookups', () => {
    const items = createItems(5_000)
    let estimateCalls = 0
    const spacer = {
      estimateItemHeight() {
        estimateCalls += 1
        return 10
      },
    } as Pick<SpacerEngine, 'estimateItemHeight'> as SpacerEngine
    const engine = new RenderWindowEngine(
      { overscan: 3, maxMountedItems: 200 },
      spacer,
    )

    expect(engine.findEstimatedIndexAtOffset(items, 1_230, 320)).toBe(122)
    expect(estimateCalls).toBe(items.length)

    expect(engine.findEstimatedIndexAtOffset(items, 8_880, 320)).toBe(887)
    expect(estimateCalls).toBe(items.length)
  })
})
