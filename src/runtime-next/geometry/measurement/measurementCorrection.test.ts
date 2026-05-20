import { describe, expect, it } from 'vitest'
import {
  calculateMountedRowsDelta,
  decideMeasurementCorrection,
} from './measurementCorrection'
import type { MeasurementGeometrySnapshot } from './measurementCorrection.types'

function createSnapshot(
  overrides: Partial<MeasurementGeometrySnapshot> = {},
): MeasurementGeometrySnapshot {
  return {
    physicalSegmentRevision: 3,
    dataRevision: 7,
    topSpacer: 100,
    bottomSpacer: 200,
    mountedRowsHeight: 500,
    physicalWindowHeight: 800,
    scrollHeightCap: 1200,
    capMode: 'normal',
    clientHeight: 300,
    scrollTop: 100,
    ...overrides,
  }
}

describe('measurement correction decision', () => {
  it('absorbs measured row growth into local spacer deltas', () => {
    expect(
      decideMeasurementCorrection({
        current: createSnapshot(),
        deltas: [{ deltaPx: 50 }],
      }),
    ).toEqual({
      kind: 'local-spacer-correction',
      topDelta: 0,
      bottomDelta: -50,
    })
  })

  it('accepts measurement facts and explicit deltas in the same ingestion pass', () => {
    expect(
      calculateMountedRowsDelta({
        facts: [
          {
            previousHeightPx: 64,
            measuredHeightPx: 80,
          },
        ],
        deltas: [{ deltaPx: -4 }],
      }),
    ).toBe(12)
  })

  it('uses the second spacer when the preferred spacer cannot absorb growth', () => {
    expect(
      decideMeasurementCorrection({
        current: createSnapshot({
          topSpacer: 100,
          bottomSpacer: 20,
          physicalWindowHeight: 620,
        }),
        deltas: [{ deltaPx: 50 }],
      }),
    ).toEqual({
      kind: 'local-spacer-correction',
      topDelta: -30,
      bottomDelta: -20,
    })
  })

  it('requests relayout when measured rows exceed the physical budget', () => {
    expect(
      decideMeasurementCorrection({
        current: createSnapshot({
          topSpacer: 50,
          mountedRowsHeight: 700,
          bottomSpacer: 50,
          physicalWindowHeight: 800,
        }),
        deltas: [{ deltaPx: 150 }],
      }),
    ).toEqual({
      kind: 'segment-relayout',
      reason: 'measurement',
    })
  })

  it('requests relayout when the current viewport would lose safe coverage', () => {
    expect(
      decideMeasurementCorrection({
        current: createSnapshot({
          topSpacer: 100,
          mountedRowsHeight: 600,
          bottomSpacer: 300,
          physicalWindowHeight: 1000,
          scrollTop: 50,
        }),
        deltas: [{ deltaPx: 0 }],
      }),
    ).toEqual({
      kind: 'segment-relayout',
      reason: 'coverage-risk',
    })
  })

  it('requests relayout when correction would expose a spacer-only viewport', () => {
    expect(
      decideMeasurementCorrection({
        current: createSnapshot({
          topSpacer: 500,
          mountedRowsHeight: 300,
          bottomSpacer: 200,
          physicalWindowHeight: 1000,
          clientHeight: 200,
          scrollTop: 0,
        }),
        deltas: [{ deltaPx: 0 }],
      }),
    ).toEqual({
      kind: 'segment-relayout',
      reason: 'coverage-risk',
    })
  })

  it('requests relayout when normal cap would be exceeded', () => {
    expect(
      decideMeasurementCorrection({
        current: createSnapshot({
          scrollHeightCap: 760,
        }),
        deltas: [{ deltaPx: 0 }],
      }),
    ).toEqual({
      kind: 'segment-relayout',
      reason: 'cap-exceeded',
    })
  })

  it('does not convert short-feed natural blank into spacer correction', () => {
    expect(
      decideMeasurementCorrection({
        current: createSnapshot({
          topSpacer: 0,
          mountedRowsHeight: 220,
          bottomSpacer: 0,
          physicalWindowHeight: 400,
          capMode: 'short-feed',
          clientHeight: 400,
          scrollTop: 0,
        }),
        deltas: [{ deltaPx: 30 }],
      }),
    ).toEqual({
      kind: 'segment-relayout',
      reason: 'measurement',
    })
  })

  it('detects same revision spacer oscillation before accepting correction', () => {
    expect(
      decideMeasurementCorrection({
        current: createSnapshot(),
        deltas: [{ deltaPx: 40 }],
        previousCorrections: [
          {
            physicalSegmentRevision: 3,
            dataRevision: 7,
            topDelta: 0,
            bottomDelta: 12,
          },
        ],
      }),
    ).toEqual({
      kind: 'segment-relayout',
      reason: 'spacer-oscillation',
    })
  })
})
