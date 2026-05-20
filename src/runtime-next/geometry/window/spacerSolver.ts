import type {
  LocalSpacerPlan,
  LocalSpacerPlacement,
  LocalSpacerSolverInput,
} from './spacerSolver.types'

export function solveLocalSpacers(
  input: LocalSpacerSolverInput,
): LocalSpacerPlan {
  const capMode = input.capMode ?? 'normal'
  const physicalWindowHeight = assertNonNegativeFinite(
    input.physicalWindowHeight,
    'physicalWindowHeight',
  )
  const mountedRowsHeightEstimate = assertNonNegativeFinite(
    input.mountedRowsHeightEstimate,
    'mountedRowsHeightEstimate',
  )

  if (mountedRowsHeightEstimate > physicalWindowHeight) {
    throw new RangeError(
      'mounted rows cannot exceed physicalWindowHeight without relayout',
    )
  }

  if (capMode === 'short-feed') {
    return {
      topSpacer: 0,
      bottomSpacer: 0,
      mountedRowsHeightEstimate,
      physicalWindowHeight,
      naturalBlankHeight: physicalWindowHeight - mountedRowsHeightEstimate,
      capMode,
    }
  }

  const spacerBudget = physicalWindowHeight - mountedRowsHeightEstimate
  const { topSpacer, bottomSpacer } = splitSpacerBudget(
    spacerBudget,
    input.placement ?? 'center',
  )

  return {
    topSpacer,
    bottomSpacer,
    mountedRowsHeightEstimate,
    physicalWindowHeight,
    naturalBlankHeight: 0,
    capMode,
  }
}

function splitSpacerBudget(
  spacerBudget: number,
  placement: LocalSpacerPlacement,
): {
  readonly topSpacer: number
  readonly bottomSpacer: number
} {
  switch (placement) {
    case 'start':
      return {
        topSpacer: 0,
        bottomSpacer: spacerBudget,
      }
    case 'end':
      return {
        topSpacer: spacerBudget,
        bottomSpacer: 0,
      }
    case 'center':
      return {
        topSpacer: spacerBudget / 2,
        bottomSpacer: spacerBudget / 2,
      }
  }
}

function assertNonNegativeFinite(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative finite number`)
  }

  return value
}
