import type { ViewportDiagnosticRecord } from '../contracts/events'
import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { RuntimeScheduler } from '../contracts/options'
import type { RuntimeDomRegistry } from './domRegistry'

type RowMetricCacheOptions = {
  scheduler: RuntimeScheduler
  onDiagnostic: (
    name: string,
    severity: ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ) => void
}

type RowMetric = {
  key: MessageRuntimeItemKey
  top: number
  bottom: number
  height: number
}

export class RuntimeRowMetricCache {
  private readonly rowMetricsByKey = new Map<MessageRuntimeItemKey, RowMetric>()
  private rowMetricOrder: RowMetric[] = []
  private rowMetricsScrollTop = 0
  private lastMetricRecordAt: number | null = null

  constructor(private readonly options: RowMetricCacheOptions) {}

  clear(): void {
    this.rowMetricsByKey.clear()
    this.rowMetricOrder = []
    this.rowMetricsScrollTop = 0
  }

  getTop(key: MessageRuntimeItemKey): number | undefined {
    return this.rowMetricsByKey.get(key)?.top
  }

  record(snapshot: ReturnType<RuntimeDomRegistry['snapshot']>): void {
    const previousKeys = new Set(this.rowMetricsByKey.keys())
    let hits = 0
    let misses = 0

    this.clear()
    this.rowMetricsScrollTop = snapshot.scrollContainer?.scrollTop ?? 0

    for (const [key, row] of snapshot.rows) {
      const rect = row.getBoundingClientRect()
      if (previousKeys.delete(key)) {
        hits += 1
      } else {
        misses += 1
      }
      const metric: RowMetric = {
        key,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      }
      this.rowMetricsByKey.set(key, metric)
      this.rowMetricOrder.push(metric)
    }
    this.rowMetricOrder.sort((first, second) => first.top - second.top)

    this.emitMeasurementCacheDiagnostics({
      hits,
      misses,
      invalidated: previousKeys.size,
      rowCount: snapshot.rows.size,
    })
    this.emitBlankAreaSample(snapshot)
    this.emitFrameGapSample()
  }

  getScrollSampleKeys(
    snapshot: ReturnType<RuntimeDomRegistry['snapshot']>,
    limit = 32,
    overscanPx = 160,
  ): string[] | undefined {
    const container = snapshot.scrollContainer

    if (!container || this.rowMetricsByKey.size === 0) {
      return undefined
    }

    const containerRect = container.getBoundingClientRect()
    const scrollDelta = container.scrollTop - this.rowMetricsScrollTop
    const viewportStart = containerRect.top + scrollDelta
    const viewportEnd = containerRect.bottom + scrollDelta
    const sampleStart = viewportStart - overscanPx
    const sampleEnd = viewportEnd + overscanPx
    const visibleStartIndex = findFirstMetricEndingAfter(
      this.rowMetricOrder,
      viewportStart,
    )
    const visibleKeys: string[] = []
    const nearKeys: string[] = []
    let visibleEndIndex = visibleStartIndex

    for (let index = visibleStartIndex; index < this.rowMetricOrder.length; index += 1) {
      const metric = this.rowMetricOrder[index]
      if (metric.top > viewportEnd) {
        break
      }

      visibleKeys.push(metric.key)
      visibleEndIndex = index + 1

      if (visibleKeys.length >= limit) {
        return visibleKeys
      }
    }

    if (visibleKeys.length === 0) {
      return collectMetricWindow(this.rowMetricOrder, sampleStart, sampleEnd, limit)
    }

    for (
      let index = visibleStartIndex - 1;
      index >= 0 && visibleKeys.length + nearKeys.length < limit;
      index -= 1
    ) {
      const metric = this.rowMetricOrder[index]
      if (metric.bottom < sampleStart) {
        break
      }
      nearKeys.unshift(metric.key)
    }

    for (
      let index = visibleEndIndex;
      index < this.rowMetricOrder.length &&
        visibleKeys.length + nearKeys.length < limit;
      index += 1
    ) {
      const metric = this.rowMetricOrder[index]
      if (metric.top > sampleEnd) {
        break
      }
      nearKeys.push(metric.key)
    }

    return [...visibleKeys, ...nearKeys].slice(0, limit)
  }

  private emitMeasurementCacheDiagnostics(input: {
    hits: number
    misses: number
    invalidated: number
    rowCount: number
  }): void {
    if (input.hits > 0) {
      this.options.onDiagnostic('measurement.cache.hit', 'debug', input)
    }
    if (input.misses > 0) {
      this.options.onDiagnostic('measurement.cache.miss', 'info', input)
    }
    if (input.invalidated > 0) {
      this.options.onDiagnostic('measurement.cache.invalidate', 'info', input)
    }
  }

  private emitBlankAreaSample(
    snapshot: ReturnType<RuntimeDomRegistry['snapshot']>,
  ): void {
    const container = snapshot.scrollContainer

    if (!container) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const rowRects = Array.from(snapshot.rows.values(), (row) =>
      row.getBoundingClientRect(),
    )
    const first = rowRects[0]
    const last = rowRects.at(-1)
    this.options.onDiagnostic('blank-area.sample', 'debug', {
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      rowCount: rowRects.length,
      blankBefore: first ? Math.max(0, first.top - containerRect.top) : 0,
      blankAfter: last ? Math.max(0, containerRect.bottom - last.bottom) : 0,
    })
  }

  private emitFrameGapSample(): void {
    const now = this.options.scheduler.now()

    if (this.lastMetricRecordAt !== null) {
      this.options.onDiagnostic('frame-gap.sample', 'debug', {
        deltaMs: now - this.lastMetricRecordAt,
      })
    }

    this.lastMetricRecordAt = now
  }
}

function collectMetricWindow(
  metrics: RowMetric[],
  start: number,
  end: number,
  limit: number,
): MessageRuntimeItemKey[] {
  const keys: MessageRuntimeItemKey[] = []
  const firstIndex = findFirstMetricEndingAfter(metrics, start)

  for (let index = firstIndex; index < metrics.length; index += 1) {
    const metric = metrics[index]
    if (metric.top > end || keys.length >= limit) {
      break
    }
    keys.push(metric.key)
  }

  return keys
}

function findFirstMetricEndingAfter(
  metrics: RowMetric[],
  threshold: number,
): number {
  let low = 0
  let high = metrics.length

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (metrics[mid].bottom < threshold) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}
