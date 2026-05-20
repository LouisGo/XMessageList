import { computeRealRowCoverage } from './coverage'
import type {
  MeasurementCorrectionDecision,
  MeasurementCorrectionInput,
  MeasurementGeometrySnapshot,
  SpacerCorrectionHistoryEntry,
  SpacerCorrectionMode,
} from './measurementCorrection.types'

const GEOMETRY_EPSILON_PX = 0.001

type SpacerCorrectionDelta = Extract<
  MeasurementCorrectionDecision,
  { readonly kind: 'local-spacer-correction' }
>

export function decideMeasurementCorrection(
  input: MeasurementCorrectionInput,
): MeasurementCorrectionDecision {
  const measuredRowsDelta = calculateMountedRowsDelta(input)
  const current = input.current
  const nextMountedRowsHeight = Math.max(
    0,
    current.mountedRowsHeight + measuredRowsDelta,
  )
  const mountedRowsDelta = nextMountedRowsHeight - current.mountedRowsHeight

  if (hasHeightConservationDrift(current)) {
    return {
      kind: 'segment-relayout',
      reason: 'measurement',
    }
  }

  if (exceedsNormalCap(current, nextMountedRowsHeight)) {
    return {
      kind: 'segment-relayout',
      reason: 'cap-exceeded',
    }
  }

  if (nextMountedRowsHeight > current.physicalWindowHeight) {
    return {
      kind: 'segment-relayout',
      reason: 'measurement',
    }
  }

  if (
    current.capMode === 'short-feed' &&
    Math.abs(mountedRowsDelta) > GEOMETRY_EPSILON_PX
  ) {
    return {
      kind: 'segment-relayout',
      reason: 'measurement',
    }
  }

  const correction = solveLocalSpacerCorrection({
    topSpacer: current.topSpacer,
    bottomSpacer: current.bottomSpacer,
    mountedRowsDelta,
    mode: input.spacerCorrectionMode ?? 'bottom-first',
  })

  if (correction === null) {
    return {
      kind: 'segment-relayout',
      reason: 'measurement',
    }
  }

  if (
    detectSameRevisionSpacerOscillation({
      current,
      correction,
      previousCorrections: input.previousCorrections ?? [],
    })
  ) {
    return {
      kind: 'segment-relayout',
      reason: 'spacer-oscillation',
    }
  }

  const nextCoverage = computeRealRowCoverage({
    topSpacer: current.topSpacer + correction.topDelta,
    mountedRowsHeight: nextMountedRowsHeight,
    clientHeight: current.clientHeight,
    scrollTop: current.scrollTop,
    minRealRowCoveragePx: current.minRealRowCoveragePx,
  })

  if (
    nextCoverage.isSpacerOnlyViewport ||
    nextCoverage.isRealRowCoverageInsufficient ||
    (!nextCoverage.isShortFeed && !nextCoverage.isWithinSafeScrollRange)
  ) {
    return {
      kind: 'segment-relayout',
      reason: 'coverage-risk',
    }
  }

  return correction
}

export function calculateMountedRowsDelta(
  input: Pick<MeasurementCorrectionInput, 'deltas' | 'facts'>,
): number {
  const deltaTotal = (input.deltas ?? []).reduce(
    (total, delta) => total + toFinitePx(delta.deltaPx),
    0,
  )
  const factTotal = (input.facts ?? []).reduce(
    (total, fact) =>
      total +
      toFinitePx(fact.measuredHeightPx) -
      toFinitePx(fact.previousHeightPx),
    0,
  )

  return deltaTotal + factTotal
}

export function detectSameRevisionSpacerOscillation(input: {
  readonly current: Pick<
    MeasurementGeometrySnapshot,
    'physicalSegmentRevision' | 'dataRevision'
  >
  readonly correction: Pick<SpacerCorrectionDelta, 'topDelta' | 'bottomDelta'>
  readonly previousCorrections: readonly SpacerCorrectionHistoryEntry[]
}): boolean {
  return input.previousCorrections.some((previous) => (
    previous.physicalSegmentRevision ===
      input.current.physicalSegmentRevision &&
    previous.dataRevision === input.current.dataRevision &&
    (
      hasOppositeSign(previous.topDelta, input.correction.topDelta) ||
      hasOppositeSign(previous.bottomDelta, input.correction.bottomDelta)
    )
  ))
}

function solveLocalSpacerCorrection(input: {
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly mountedRowsDelta: number
  readonly mode: SpacerCorrectionMode
}): SpacerCorrectionDelta | null {
  if (Math.abs(input.mountedRowsDelta) <= GEOMETRY_EPSILON_PX) {
    return {
      kind: 'local-spacer-correction',
      topDelta: 0,
      bottomDelta: 0,
    }
  }

  if (input.mountedRowsDelta < 0) {
    const spacerGrowth = -input.mountedRowsDelta

    return {
      kind: 'local-spacer-correction',
      topDelta: input.mode === 'top-first' ? spacerGrowth : 0,
      bottomDelta: input.mode === 'bottom-first' ? spacerGrowth : 0,
    }
  }

  return shrinkSpacersForMountedRowsGrowth(input)
}

function shrinkSpacersForMountedRowsGrowth(input: {
  readonly topSpacer: number
  readonly bottomSpacer: number
  readonly mountedRowsDelta: number
  readonly mode: SpacerCorrectionMode
}): SpacerCorrectionDelta | null {
  let remaining = input.mountedRowsDelta
  let topDelta = 0
  let bottomDelta = 0

  const shrinkBottomFirst = input.mode === 'bottom-first'
  const firstSpacer = shrinkBottomFirst ? input.bottomSpacer : input.topSpacer
  const firstShrink = Math.min(firstSpacer, remaining)
  remaining -= firstShrink

  if (shrinkBottomFirst) {
    bottomDelta = -firstShrink
  } else {
    topDelta = -firstShrink
  }

  const secondSpacer = shrinkBottomFirst ? input.topSpacer : input.bottomSpacer
  const secondShrink = Math.min(secondSpacer, remaining)
  remaining -= secondShrink

  if (shrinkBottomFirst) {
    topDelta = -secondShrink
  } else {
    bottomDelta = -secondShrink
  }

  if (remaining > GEOMETRY_EPSILON_PX) {
    return null
  }

  return {
    kind: 'local-spacer-correction',
    topDelta: normalizeSignedZero(topDelta),
    bottomDelta: normalizeSignedZero(bottomDelta),
  }
}

function hasHeightConservationDrift(
  current: MeasurementGeometrySnapshot,
): boolean {
  const contentHeight =
    current.topSpacer +
    current.mountedRowsHeight +
    current.bottomSpacer

  if (current.capMode === 'short-feed') {
    return contentHeight - current.physicalWindowHeight >
      GEOMETRY_EPSILON_PX
  }

  return Math.abs(contentHeight - current.physicalWindowHeight) >
    GEOMETRY_EPSILON_PX
}

function exceedsNormalCap(
  current: MeasurementGeometrySnapshot,
  nextMountedRowsHeight: number,
): boolean {
  if (current.capMode === 'exceptional-row') {
    return false
  }

  return (
    current.physicalWindowHeight - current.scrollHeightCap >
      GEOMETRY_EPSILON_PX ||
    nextMountedRowsHeight - current.scrollHeightCap >
      GEOMETRY_EPSILON_PX
  )
}

function hasOppositeSign(a: number, b: number): boolean {
  return Math.abs(a) > GEOMETRY_EPSILON_PX &&
    Math.abs(b) > GEOMETRY_EPSILON_PX &&
    Math.sign(a) !== Math.sign(b)
}

function toFinitePx(value: number): number {
  return Number.isFinite(value)
    ? value
    : 0
}

function normalizeSignedZero(value: number): number {
  return Object.is(value, -0)
    ? 0
    : value
}
