import { describe, expect, it } from 'vitest'
import { MeasurementEngine } from '../dom/measurementEngine'
import type { RuntimeObserverFactory } from '..'
import { setElementMetrics } from '../../test/fakes'

describe('MeasurementEngine', () => {
  it('uses ResizeObserver box size before falling back to layout reads', () => {
    let resizeCallback: ResizeObserverCallback | null = null
    const observers: RuntimeObserverFactory = {
      createResizeObserver(callback) {
        resizeCallback = callback
        return {
          observe() {},
          unobserve() {},
          disconnect() {},
        } as ResizeObserver
      },
      createIntersectionObserver() {
        return null
      },
    }
    const heightCache = new Map()
    const engine = new MeasurementEngine(heightCache, observers, () => {})
    const row = document.createElement('div')
    const key = { kind: 'committed' as const, messageId: 'm-1' }
    const item = {
      kind: 'committed' as const,
      key,
      message: { id: 'm-1' },
      version: 1,
    }

    setElementMetrics(row, { top: 0, height: 40 })
    engine.observeRow(key, row)
    engine.measureMountedRows([item], 1, 320)
    row.getBoundingClientRect = () => {
      throw new Error('layout read fallback should not run')
    }

    resizeCallback?.(
      [
        {
          target: row,
          borderBoxSize: [{ blockSize: 64 }] as ResizeObserverSize[],
          contentRect: { height: 0 } as DOMRectReadOnly,
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    )

    const deltas = engine.flushPendingHeightDeltas(2, 320)
    expect(deltas[0]?.nextHeight).toBe(64)
  })
})
