import type { PhysicalSegmentRole } from '../geometry/segment/physicalSegment.types'
import type { PhysicalRowSelectionDirectionHint } from '../geometry/window/rowSelection.types'
import type { LocalSpacerPlacement } from '../geometry/window/spacerSolver.types'
import type { GeometryBuildInput } from './geometryBuilder.types'

export function resolveGeometryDirectionHint(
  input: GeometryBuildInput,
): PhysicalRowSelectionDirectionHint {
  if (input.kind === 'followBottom') return 'latest'
  if (input.kind === 'bootstrap') {
    return input.target === undefined ? 'latest' : 'target'
  }
  if (input.kind === 'segmentShift') {
    return input.direction === 'before' ? 'after' : 'before'
  }
  if (
    input.kind === 'jump' ||
    input.kind === 'restore' ||
    input.kind === 'segmentRelayout'
  ) {
    return 'target'
  }

  return input.direction ?? 'latest'
}

export function resolveGeometrySpacerPlacement(
  input: GeometryBuildInput,
): LocalSpacerPlacement {
  if (input.kind === 'bootstrap') {
    return input.target === undefined ? 'end' : 'center'
  }
  if (input.kind === 'segmentRelayout') {
    const role = input.currentSegment?.logicalRole
    if (role === 'latest' || role === 'short-feed') return 'end'
    if (role === 'target') return 'center'
  }
  if (input.kind === 'followBottom' || input.direction === 'before') return 'end'
  if (input.kind === 'jump' || input.kind === 'restore') return 'center'

  return 'start'
}

export function resolveGeometryRole(
  input: GeometryBuildInput,
): PhysicalSegmentRole {
  if (input.kind === 'segmentRelayout') {
    return input.currentSegment?.logicalRole ?? 'history'
  }
  if (
    input.kind === 'followBottom' ||
    (input.kind === 'bootstrap' &&
      input.target === undefined &&
      !input.data.hasMoreAfter)
  ) {
    return 'latest'
  }
  if (
    input.kind === 'jump' ||
    input.kind === 'restore' ||
    (input.kind === 'bootstrap' && input.target !== undefined)
  ) {
    return 'target'
  }

  return 'history'
}
