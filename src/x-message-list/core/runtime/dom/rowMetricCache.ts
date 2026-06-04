import type { ViewportDiagnosticRecord } from '../contracts/events'
import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { RuntimeScheduler } from '../contracts/options'
import type { RuntimeDomRegistry } from './domRegistry'
import type { RuntimeMeasurement } from './measurement'

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

  record(
    snapshot: ReturnType<RuntimeDomRegistry['snapshot']>,
    measurement?: RuntimeMeasurement,
  ): void {
    const previousKeys = new Set(this.rowMetricsByKey.keys())
    let hits = 0
    let misses = 0
    const measuredMetrics = createMetricsFromMeasurement(snapshot, measurement)

    this.clear()
    this.rowMetricsScrollTop = measurement?.scrollTop ??
      snapshot.scrollContainer?.scrollTop ??
      0

    const metrics = measuredMetrics ?? Array.from(snapshot.rows, ([key, row]) => {
      const rect = row.getBoundingClientRect()
      return {
        key,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      }
    })

    for (const metric of metrics) {
      if (previousKeys.delete(metric.key)) {
        hits += 1
      } else {
        misses += 1
      }
      this.rowMetricsByKey.set(metric.key, metric)
      this.rowMetricOrder.push(metric)
    }
    this.rowMetricOrder.sort((first, second) => first.top - second.top)

    this.emitMeasurementCacheDiagnostics({
      hits,
      misses,
      invalidated: previousKeys.size,
      rowCount: snapshot.rows.size,
    })
    this.emitBlankAreaSample(snapshot, measurement)
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
    measurement?: RuntimeMeasurement,
  ): void {
    const container = snapshot.scrollContainer

    if (!container) {
      return
    }

    const containerRect = measurement
      ? { top: measurement.viewportTop, bottom: measurement.viewportBottom }
      : container.getBoundingClientRect()
    const first = this.rowMetricOrder[0]
    const last = this.rowMetricOrder.at(-1)
    this.options.onDiagnostic('blank-area.sample', 'debug', {
      scrollTop: measurement?.scrollTop ?? container.scrollTop,
      clientHeight: measurement?.clientHeight ?? container.clientHeight,
      scrollHeight: measurement?.scrollHeight ?? container.scrollHeight,
      rowCount: this.rowMetricOrder.length,
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

function createMetricsFromMeasurement(
  snapshot: ReturnType<RuntimeDomRegistry['snapshot']>,
  measurement?: RuntimeMeasurement,
): RowMetric[] | null {
  if (!measurement || measurement.visibleRows.length !== snapshot.rows.size) {
    return null
  }

  const remainingKeys = new Set(snapshot.rows.keys())
  const metrics: RowMetric[] = []

  for (const row of measurement.visibleRows) {
    if (!remainingKeys.delete(row.key)) {
      return null
    }
    metrics.push({
      key: row.key,
      top: row.top,
      bottom: row.bottom,
      height: row.bottom - row.top,
    })
  }

  return remainingKeys.size === 0 ? metrics : null
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
