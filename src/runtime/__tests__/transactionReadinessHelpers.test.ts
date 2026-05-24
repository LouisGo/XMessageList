import { describe, expect, it, vi } from 'vitest'
import type { ViewportTransactionDeps } from '../transactions/viewportTransactionController'
import {
  correctPreservedAnchorAfterCommit,
} from '../transactions/scrollCorrectionLedger'
import { resolveMeasuredTarget } from '../transactions/measurementReadinessBarrier'
import type { MessageRuntimeItemKey } from '..'
import { createContainer, setElementMetrics } from './runtimeTestUtils'

const key: MessageRuntimeItemKey = { kind: 'committed', messageId: 'm-1' }

describe('transaction readiness helpers', () => {
  it('applies preserved-anchor correction synchronously when the anchor row is ready', () => {
    const container = createContainer({ height: 300 })
    const row = document.createElement('div')
    const writeScrollTop = vi.fn((nextScrollTop: number) => {
      container.scrollTop = nextScrollTop
    })
    const deps = createDeps({
      row,
      writeScrollTop,
    })

    container.scrollTop = 100
    setElementMetrics(row, { top: 140, height: 50 })

    const result = correctPreservedAnchorAfterCommit(deps, {
      data: createData(),
      container,
      renderWindow: createWindow(),
      target: { key, offsetWithinMessage: 0, index: 0 },
      anchorTopBefore: 100,
      missingDomErrorCode: 'missing',
      missingAnchorAfterPolicy: 'return',
    })

    expect(result).not.toBeInstanceOf(Promise)
    expect(result).toEqual({
      status: 'applied',
      delta: 40,
      measuredCount: 0,
    })
    expect(writeScrollTop).toHaveBeenCalledWith(140, 'recovery')
    expect(container.scrollTop).toBe(140)
  })

  it('does not write scrollTop for sub-pixel preserved-anchor deltas', () => {
    const container = createContainer({ height: 300 })
    const row = document.createElement('div')
    const writeScrollTop = vi.fn()
    const deps = createDeps({ row, writeScrollTop })

    setElementMetrics(row, { top: 100.25, height: 50 })

    const result = correctPreservedAnchorAfterCommit(deps, {
      data: createData(),
      container,
      renderWindow: createWindow(),
      target: { key, offsetWithinMessage: 0, index: 0 },
      anchorTopBefore: 100,
      missingDomErrorCode: 'missing',
      missingAnchorAfterPolicy: 'return',
    })

    expect(result).toEqual({
      status: 'within-epsilon',
      delta: 0.25,
      measuredCount: 0,
    })
    expect(writeScrollTop).not.toHaveBeenCalled()
  })

  it('keeps target readiness synchronous for already registered rows', () => {
    const row = document.createElement('div')
    const deps = createDeps({ row })

    const result = resolveMeasuredTarget(deps, {
      data: createData(),
      targetKey: key,
      targetIndex: 0,
      renderWindow: createWindow(),
      missingDomErrorCode: 'missing',
      transactionKind: 'restore',
    })

    expect(result).not.toBeInstanceOf(Promise)
    expect(result).toEqual({ key, element: row })
    expect(deps.measureCurrentWindow).toHaveBeenCalledTimes(1)
  })

  it('only becomes async when target readiness needs fallback resolution', async () => {
    const row = document.createElement('div')
    const deps = createDeps({
      row: null,
      resolveRow: Promise.resolve({ key, element: row }),
    })

    const result = resolveMeasuredTarget(deps, {
      data: createData(),
      targetKey: key,
      targetIndex: 0,
      renderWindow: createWindow(),
      missingDomErrorCode: 'missing',
      transactionKind: 'restore',
    })

    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toEqual({ key, element: row })
    expect(deps.measureCurrentWindow).toHaveBeenCalledTimes(1)
  })
})

function createDeps(input: {
  row: HTMLElement | null
  writeScrollTop?: (nextScrollTop: number, source: string) => void
  resolveRow?: Promise<{ key: MessageRuntimeItemKey; element: HTMLElement } | null>
}): ViewportTransactionDeps<unknown, unknown> {
  return {
    registry: {
      getRow: vi.fn(() => input.row),
    },
    measureCurrentWindow: vi.fn(() => []),
    setViewportPhase: vi.fn(),
    motion: {
      writeScrollTop: input.writeScrollTop ?? vi.fn(),
    },
    anchor: {
      getDirectMeasurableRow: vi.fn(() =>
        input.row ? { key, element: input.row } : null,
      ),
      resolveMeasurableRowForTarget: vi.fn(() =>
        input.resolveRow ?? Promise.resolve(null),
      ),
      alignToResolvedRestoreTarget: vi.fn(),
    },
    emitDiagnostic: vi.fn(),
  } as unknown as ViewportTransactionDeps<unknown, unknown>
}

function createData() {
  return {
    feedId: 'feed',
    generation: 1,
    revision: 1,
    items: [],
    hasMoreBefore: false,
    hasMoreAfter: false,
    change: { kind: 'patch' as const },
  }
}

function createWindow() {
  return {
    startIndex: 0,
    endIndex: 0,
    itemKeys: [key],
  }
}
