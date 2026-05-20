import type {
  CreateGeometryDiagnosticInput,
  CreateSegmentRelayoutDiagnosticInput,
  GeometryDiagnosticKind,
  GeometryDiagnosticPayload,
  GeometryDiagnosticPayloadInput,
  GeometryDiagnosticRecord,
  GeometryDiagnosticSeverity,
} from './geometryDiagnostics.types'

export const GEOMETRY_DIAGNOSTIC_KINDS = [
  'physical.windowSelected',
  'physical.segmentRelayout',
  'physical.scrollHeightExceededCap',
  'physical.domScrollHeightMismatch',
  'physical.spacerOnlyViewport',
  'physical.realRowCoverageInsufficient',
  'physical.spacerOscillationSameRevision',
  'physical.capExceededByRow',
] as const satisfies readonly GeometryDiagnosticKind[]

const GEOMETRY_DIAGNOSTIC_SEVERITY = {
  'physical.windowSelected': 'info',
  'physical.segmentRelayout': 'info',
  'physical.scrollHeightExceededCap': 'error',
  'physical.domScrollHeightMismatch': 'error',
  'physical.spacerOnlyViewport': 'error',
  'physical.realRowCoverageInsufficient': 'error',
  'physical.spacerOscillationSameRevision': 'warn',
  'physical.capExceededByRow': 'warn',
} as const satisfies Record<GeometryDiagnosticKind, GeometryDiagnosticSeverity>

export function getGeometryDiagnosticSeverity(
  kind: GeometryDiagnosticKind,
): GeometryDiagnosticSeverity {
  return GEOMETRY_DIAGNOSTIC_SEVERITY[kind]
}

export function createGeometryDiagnosticPayload(
  input: GeometryDiagnosticPayloadInput,
): GeometryDiagnosticPayload {
  const physicalWindowHeight = toNonNegativeFinitePx(
    input.physicalWindowHeight,
  )
  const clientHeight = toNonNegativeFinitePx(input.clientHeight)

  return {
    dataRevision: input.dataRevision,
    physicalSegmentId: input.physicalSegmentId,
    physicalSegmentRevision: input.physicalSegmentRevision,
    renderWindowStart: input.renderWindowStart,
    renderWindowEnd: input.renderWindowEnd,
    topSpacer: toNonNegativeFinitePx(input.topSpacer),
    bottomSpacer: toNonNegativeFinitePx(input.bottomSpacer),
    mountedRowsHeight: toNonNegativeFinitePx(input.mountedRowsHeight),
    scrollTop: toNonNegativeFinitePx(input.scrollTop),
    scrollHeight: toNonNegativeFinitePx(input.scrollHeight),
    domScrollHeight: toNonNegativeFinitePx(input.domScrollHeight),
    clientHeight,
    physicalWindowHeight,
    maxScrollPosition: Math.max(0, physicalWindowHeight - clientHeight),
    scrollHeightCap: toNonNegativeFinitePx(input.scrollHeightCap),
    capMode: input.capMode,
    safeScrollRangeStart: toNonNegativeFinitePx(
      input.coverage.safeScrollRangeStart,
    ),
    safeScrollRangeEnd: toNonNegativeFinitePx(
      input.coverage.safeScrollRangeEnd,
    ),
    realRowCoveragePx: toNonNegativeFinitePx(
      input.coverage.realRowCoveragePx,
    ),
    minRealRowCoveragePx: toNonNegativeFinitePx(
      input.coverage.minRealRowCoveragePx,
    ),
  }
}

export function createGeometryDiagnosticRecord(
  input: CreateGeometryDiagnosticInput,
): GeometryDiagnosticRecord {
  const ts = input.now?.() ?? Date.now()
  const payload = createGeometryDiagnosticPayload(input.payload)

  return createRecord({
    id: input.id,
    kind: input.kind,
    payload,
    severity: input.severity,
    details: input.details,
    ts,
  })
}

export function createSegmentRelayoutDiagnostic(
  input: CreateSegmentRelayoutDiagnosticInput,
): GeometryDiagnosticRecord {
  return createGeometryDiagnosticRecord({
    ...input,
    kind: 'physical.segmentRelayout',
    details: {
      reason: input.reason,
    },
  })
}

function createRecord(input: {
  readonly id?: string
  readonly kind: GeometryDiagnosticKind
  readonly payload: GeometryDiagnosticPayload
  readonly severity?: GeometryDiagnosticSeverity
  readonly details?: Readonly<Record<string, unknown>>
  readonly ts: number
}): GeometryDiagnosticRecord {
  return {
    id: input.id ?? createGeometryDiagnosticId(input.kind, input.payload, input.ts),
    ts: input.ts,
    kind: input.kind,
    severity: input.severity ?? getGeometryDiagnosticSeverity(input.kind),
    payload: input.payload,
    details: input.details,
  }
}

function createGeometryDiagnosticId(
  kind: GeometryDiagnosticKind,
  payload: GeometryDiagnosticPayload,
  ts: number,
): string {
  const segmentId = payload.physicalSegmentId ?? 'none'

  return `${kind}:${segmentId}:r${payload.physicalSegmentRevision}:${ts}`
}

function toNonNegativeFinitePx(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}
