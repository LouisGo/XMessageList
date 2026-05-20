import { describe, expect, it } from 'vitest'
import type {
  MessageRuntimeItemKey,
} from '../../identity/types'
import type { MessageDataItem } from '../../projection/types'
import { computePhysicalHeightBudget } from '../budget/heightBudget'
import { selectPhysicalRows } from './rowSelection'

function committedKey(
  messageId: string,
): Extract<MessageRuntimeItemKey, { kind: 'committed' }> {
  return {
    kind: 'committed',
    messageId,
  }
}

function createItem(
  messageId: string,
  estimatedHeight?: number,
): MessageDataItem<{ id: string }> {
  const item = {
    kind: 'committed' as const,
    key: committedKey(messageId),
    message: {
      id: messageId,
    },
    version: 1,
  }

  return estimatedHeight === undefined
    ? item
    : {
        ...item,
        estimatedHeight,
      }
}

function createItems(
  count: number,
  estimatedHeight: number,
): readonly MessageDataItem<{ id: string }>[] {
  return Array.from({ length: count }, (_, index) =>
    createItem(`m-${index}`, estimatedHeight),
  )
}

describe('physical row selection', () => {
  it('selects an anchor-centered render window by estimated row height', () => {
    const items = createItems(10, 50)
    const selection = selectPhysicalRows({
      items,
      anchor: {
        key: committedKey('m-5'),
        offsetWithinMessage: 0,
      },
      directionHint: 'target',
      maxMountedHeight: 250,
    })

    expect(selection).toEqual({
      startIndex: 3,
      endIndex: 7,
      itemKeys: ['m-3', 'm-4', 'm-5', 'm-6', 'm-7'].map(committedKey),
      mountedRowsHeightEstimate: 250,
      anchorIndex: 5,
      capFallbackIntent: null,
    })
  })

  it('selects latest rows from the physical bottom using default estimates', () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      createItem(`m-${index}`),
    )
    const selection = selectPhysicalRows({
      items,
      directionHint: 'latest',
      maxMountedHeight: 150,
      config: {
        defaultEstimatedRowHeightPx: 48,
      },
    })

    expect(selection.startIndex).toBe(5)
    expect(selection.endIndex).toBe(7)
    expect(selection.itemKeys).toEqual(['m-5', 'm-6', 'm-7'].map(committedKey))
    expect(selection.mountedRowsHeightEstimate).toBe(144)
  })

  it('clamps mounted rows by height before considering more candidate items', () => {
    const items = [
      createItem('m-0', 100),
      createItem('m-1', 150),
      createItem('m-2', 200),
      createItem('m-3', 80),
      createItem('m-4', 80),
    ]
    const selection = selectPhysicalRows({
      items,
      anchor: {
        key: committedKey('m-2'),
        offsetWithinMessage: 0,
      },
      directionHint: 'target',
      maxMountedHeight: 300,
    })

    expect(selection.startIndex).toBe(2)
    expect(selection.endIndex).toBe(3)
    expect(selection.itemKeys).toEqual(['m-2', 'm-3'].map(committedKey))
    expect(selection.mountedRowsHeightEstimate).toBeLessThanOrEqual(300)
  })

  it('uses maxMountedItems only as a safety valve', () => {
    const selection = selectPhysicalRows({
      items: createItems(10, 10),
      directionHint: 'latest',
      maxMountedHeight: 1000,
      config: {
        maxMountedItems: 3,
      },
    })

    expect(selection.startIndex).toBe(7)
    expect(selection.endIndex).toBe(9)
    expect(selection.itemKeys).toHaveLength(3)
    expect(selection.mountedRowsHeightEstimate).toBe(30)
    expect(selection.capFallbackIntent).toBeNull()
  })

  it('keeps an oversized anchor row selectable for exceptional cap fallback', () => {
    const items = [
      createItem('m-0', 80),
      createItem('m-1', 900),
      createItem('m-2', 80),
    ]
    const selection = selectPhysicalRows({
      items,
      anchor: {
        key: committedKey('m-1'),
        offsetWithinMessage: 0,
      },
      directionHint: 'target',
      maxMountedHeight: 400,
    })

    expect(selection.startIndex).toBe(1)
    expect(selection.endIndex).toBe(1)
    expect(selection.itemKeys).toEqual([committedKey('m-1')])
    expect(selection.mountedRowsHeightEstimate).toBe(900)
    expect(selection.capFallbackIntent).toEqual({
      kind: 'exceptional-row',
      reason: 'anchor-row-exceeds-mounted-budget',
      rowIndex: 1,
      rowHeightEstimate: 900,
    })
  })

  it('lets oversized anchor selection drive exceptional-row height budget', () => {
    const selection = selectPhysicalRows({
      items: [createItem('huge', 1500)],
      directionHint: 'target',
      maxMountedHeight: 500,
    })
    const budget = computePhysicalHeightBudget({
      clientHeight: 400,
      mountedRowsHeight: selection.mountedRowsHeightEstimate,
      config: {
        maxPhysicalScrollHeightPx: 1200,
        maxPhysicalViewportMultiplier: 3,
        minimumSafeBufferPx: 160,
      },
    })

    expect(selection.capFallbackIntent?.kind).toBe('exceptional-row')
    expect(budget).toEqual({
      physicalWindowHeight: 1660,
      scrollHeightCap: 1200,
      capMode: 'exceptional-row',
    })
  })

  it('derives mounted height budget from physicalWindowHeight when needed', () => {
    const selection = selectPhysicalRows({
      items: createItems(6, 70),
      directionHint: 'latest',
      physicalWindowHeight: 300,
      config: {
        minimumSafeBufferPx: 60,
      },
    })

    expect(selection.itemKeys).toEqual(['m-3', 'm-4', 'm-5'].map(committedKey))
    expect(selection.mountedRowsHeightEstimate).toBe(210)
  })

  it('rejects impossible negative mounted height budget', () => {
    expect(() =>
      selectPhysicalRows({
        items: createItems(1, 50),
        directionHint: 'latest',
        maxMountedHeight: -1,
      }),
    ).toThrow(/maxMountedHeight/)
  })
})
