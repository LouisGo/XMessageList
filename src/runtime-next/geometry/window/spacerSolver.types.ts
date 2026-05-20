import type { PhysicalSegmentCapMode } from '../types'

export type LocalSpacerPlacement =
  | 'start'
  | 'center'
  | 'end'

export type LocalSpacerSolverInput = {
  readonly physicalWindowHeight: number
  readonly mountedRowsHeightEstimate: number
  readonly capMode?: PhysicalSegmentCapMode
  readonly placement?: LocalSpacerPlacement
}

export type LocalSpacerPlan = {
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly mountedRowsHeightEstimate: number
  readonly physicalWindowHeight: number
  readonly naturalBlankHeight: number
  readonly capMode: PhysicalSegmentCapMode
}
