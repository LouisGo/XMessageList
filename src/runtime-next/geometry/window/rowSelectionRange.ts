import type { PhysicalRowCapFallbackIntent } from './rowSelection.types'

export type MutableRowSelectionRange = {
  startIndex: number
  endIndex: number
  mountedRowsHeightEstimate: number
  itemCount: number
  beforeHeight: number
  afterHeight: number
  capFallbackIntent: PhysicalRowCapFallbackIntent | null
}

export function createSingleRowRange(
  anchorIndex: number,
  anchorHeight: number,
): MutableRowSelectionRange {
  return {
    startIndex: anchorIndex,
    endIndex: anchorIndex,
    mountedRowsHeightEstimate: anchorHeight,
    itemCount: 1,
    beforeHeight: 0,
    afterHeight: 0,
    capFallbackIntent: null,
  }
}

export function createExceptionalRowRange(
  anchorIndex: number,
  anchorHeight: number,
): MutableRowSelectionRange {
  return {
    ...createSingleRowRange(anchorIndex, anchorHeight),
    capFallbackIntent: {
      kind: 'exceptional-row',
      reason: 'anchor-row-exceeds-mounted-budget',
      rowIndex: anchorIndex,
      rowHeightEstimate: anchorHeight,
    },
  }
}
