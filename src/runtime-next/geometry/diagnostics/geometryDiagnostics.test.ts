import { describe, expect, it } from 'vitest'
import { computeRealRowCoverage } from '../measurement/coverage'
import {
  GEOMETRY_DIAGNOSTIC_KINDS,
  createGeometryDiagnosticRecord,
  createSegmentRelayoutDiagnostic,
  getGeometryDiagnosticSeverity,
} from './geometryDiagnostics'
import type { GeometryDiagnosticPayloadInput } from './geometryDiagnostics.types'
import type { MessageRuntimeItemKey } from '../../identity/types'

function committedKey(messageId: string): MessageRuntimeItemKey {
  return {
    kind: 'committed',
    messageId,
  }
}

function createPayloadInput(
  overrides: Partial<GeometryDiagnosticPayloadInput> = {},
): GeometryDiagnosticPayloadInput {
  const coverage = computeRealRowCoverage({
    topSpacer: 100,
    mountedRowsHeight: 600,
    clientHeight: 300,
    scrollTop: 100,
  })

  return {
    dataRevision: 9,
    physicalSegmentId: 'segment-1',
    physicalSegmentRevision: 4,
    renderWindowStart: committedKey('m-start'),
    renderWindowEnd: committedKey('m-end'),
    topSpacer: 100,
    bottomSpacer: 300,
    mountedRowsHeight: 600,
    scrollTop: 100,
    domScrollHeight: 1000,
    clientHeight: 300,
    physicalWindowHeight: 1000,
    scrollHeightCap: 1200,
    capMode: 'normal',
    coverage,
    ...overrides,
  }
}

describe('geometry diagnostics helpers', () => {
  it('keeps the P3 physical diagnostic kinds local to geometry', () => {
    expect(GEOMETRY_DIAGNOSTIC_KINDS).toEqual([
      'physical.windowSelected',
      'physical.segmentRelayout',
      'physical.scrollHeightExceededCap',
      'physical.spacerOnlyViewport',
      'physical.realRowCoverageInsufficient',
      'physical.spacerOscillationSameRevision',
      'physical.capExceededByRow',
    ])
    expect(getGeometryDiagnosticSeverity('physical.windowSelected')).toBe('info')
    expect(getGeometryDiagnosticSeverity('physical.segmentRelayout')).toBe('info')
    expect(getGeometryDiagnosticSeverity('physical.scrollHeightExceededCap')).toBe('error')
    expect(getGeometryDiagnosticSeverity('physical.spacerOnlyViewport')).toBe('error')
    expect(getGeometryDiagnosticSeverity('physical.realRowCoverageInsufficient')).toBe('error')
    expect(getGeometryDiagnosticSeverity('physical.spacerOscillationSameRevision')).toBe('warn')
    expect(getGeometryDiagnosticSeverity('physical.capExceededByRow')).toBe('warn')
  })

  it('emits complete local payload fields for a window selection diagnostic', () => {
    const record = createGeometryDiagnosticRecord({
      kind: 'physical.windowSelected',
      payload: createPayloadInput(),
      now: () => 123,
    })

    expect(record).toEqual({
      id: 'physical.windowSelected:segment-1:r4:123',
      ts: 123,
      kind: 'physical.windowSelected',
      severity: 'info',
      payload: expect.objectContaining({
        dataRevision: 9,
        physicalSegmentId: 'segment-1',
        physicalSegmentRevision: 4,
        renderWindowStart: committedKey('m-start'),
        renderWindowEnd: committedKey('m-end'),
        topSpacer: 100,
        bottomSpacer: 300,
        mountedRowsHeight: 600,
        scrollTop: 100,
        domScrollHeight: 1000,
        clientHeight: 300,
        physicalWindowHeight: 1000,
        maxScrollPosition: 700,
        scrollHeightCap: 1200,
        capMode: 'normal',
        safeScrollRangeStart: 100,
        safeScrollRangeEnd: 400,
        realRowCoveragePx: 300,
        minRealRowCoveragePx: 300,
      }),
      details: undefined,
    })
  })

  it('attaches relayout reason details without changing the public diagnostics contract', () => {
    const record = createSegmentRelayoutDiagnostic({
      payload: createPayloadInput(),
      reason: 'measurement',
      now: () => 456,
    })

    expect(record.kind).toBe('physical.segmentRelayout')
    expect(record.severity).toBe('info')
    expect(record.details).toEqual({
      reason: 'measurement',
    })
  })

  it('preserves coverage failure fields in error diagnostics', () => {
    const coverage = computeRealRowCoverage({
      topSpacer: 500,
      mountedRowsHeight: 300,
      clientHeight: 200,
      scrollTop: 0,
    })
    const record = createGeometryDiagnosticRecord({
      kind: 'physical.spacerOnlyViewport',
      payload: createPayloadInput({
        topSpacer: 500,
        bottomSpacer: 200,
        mountedRowsHeight: 300,
        physicalWindowHeight: 1000,
        clientHeight: 200,
        scrollTop: 0,
        coverage,
      }),
      now: () => 789,
    })

    expect(record.severity).toBe('error')
    expect(record.payload.safeScrollRangeStart).toBe(500)
    expect(record.payload.safeScrollRangeEnd).toBe(600)
    expect(record.payload.realRowCoveragePx).toBe(0)
    expect(record.payload.minRealRowCoveragePx).toBe(200)
  })
})
