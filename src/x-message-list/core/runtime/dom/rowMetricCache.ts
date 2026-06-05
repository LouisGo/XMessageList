import type { ViewportDiagnosticRecord } from '../contracts/events'
import type { MessageRuntimeItemKey } from '../contracts/identity'
import type { RuntimeScheduler } from '../contracts/options'
import type { RuntimeDomRegistry } from './domRegistry'
import type { RuntimeMeasurement } from './measurement'

export type RuntimeMeasurementSource = 'transaction' | 'resize' | 'scroll-sample'

export type RuntimeRowSizeRecord = {
  key: MessageRuntimeItemKey
  height: number
  top: number
  bottom: number
  contentTop: number
  contentBottom: number
  widthBucket: number
  renderVersion: number
  generation: number
  segmentRevision: number
  projectionRevision: number
  dirty: boolean
  source: RuntimeMeasurementSource
}

export type RuntimeSegmentSizeSnapshot = {
  sessionId: string
  generation: number
  segmentRevision: number
  widthBucket: number
  rows: Array<{
    key: MessageRuntimeItemKey
    height: number
    renderVersion: number
  }>
  anchor?: {
    key: MessageRuntimeItemKey
    offsetWithinMessage: number
  }
}

type RowMetricCacheOptions = {
  scheduler: RuntimeScheduler
  onDiagnostic: (
    name: string,
    severity: ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown>,
  ) => void
}

export type RuntimeMeasurementCacheContext = {
  generation: number
  segmentRevision: number
  projectionRevision: number
  source: RuntimeMeasurementSource
  dirtyKeys?: Iterable<MessageRuntimeItemKey>
}

export class RuntimeRowMetricCache {
  private readonly rowMetricsByKey = new Map<MessageRuntimeItemKey, RuntimeRowSizeRecord>()
  private rowMetricOrder: RuntimeRowSizeRecord[] = []
  private lastMetricRecordAt: number | null = null
  private widthBucket = 0

  constructor(private readonly options: RowMetricCacheOptions) {}

  clear(): void {
    const invalidated = this.rowMetricsByKey.size
    this.rowMetricsByKey.clear()
    this.rowMetricOrder = []

    if (invalidated > 0) {
      this.options.onDiagnostic('measurement.cache.invalidate', 'info', {
        invalidated,
        reason: 'clear',
      })
    }
  }

  deleteKey(key: MessageRuntimeItemKey): void {
    if (!this.rowMetricsByKey.delete(key)) {
      return
    }
    this.rebuildMetricOrder()
    this.options.onDiagnostic('measurement.cache.invalidate', 'info', {
      invalidated: 1,
      reason: 'row-detach',
      key,
    })
  }

  markDirty(key: MessageRuntimeItemKey): void {
    const record = this.rowMetricsByKey.get(key)
    if (record) {
      record.dirty = true
    }
  }

  markDirtyKeys(keys: Iterable<MessageRuntimeItemKey>): void {
    for (const key of keys) {
      this.markDirty(key)
    }
  }

  markAllDirty(reason: string): void {
    let dirty = 0
    for (const record of this.rowMetricsByKey.values()) {
      if (!record.dirty) {
        dirty += 1
      }
      record.dirty = true
    }

    if (dirty > 0) {
      this.options.onDiagnostic('measurement.cache.invalidate', 'info', {
        invalidated: dirty,
        reason,
      })
    }
  }

  invalidateAfterIndex(
    snapshotItems: Array<{ key: MessageRuntimeItemKey }>,
    index: number | null,
    reason: string,
  ): void {
    if (index === null) {
      return
    }

    let invalidated = 0

    for (let itemIndex = index + 1; itemIndex < snapshotItems.length; itemIndex += 1) {
      if (this.rowMetricsByKey.delete(snapshotItems[itemIndex].key)) {
        invalidated += 1
      }
    }

    if (invalidated === 0) {
      return
    }

    this.rebuildMetricOrder()
    this.options.onDiagnostic('measurement.cache.invalidate', 'info', {
      invalidated,
      reason,
      firstIndex: index,
    })
  }

  remapKey(
    previousKey: MessageRuntimeItemKey | undefined,
    nextKey: MessageRuntimeItemKey,
  ): void {
    if (!previousKey || previousKey === nextKey) {
      this.markDirty(nextKey)
      return
    }

    const previous = this.rowMetricsByKey.get(previousKey)
    if (!previous) {
      this.markDirty(nextKey)
      return
    }

    this.rowMetricsByKey.delete(previousKey)
    this.rowMetricsByKey.set(nextKey, {
      ...previous,
      key: nextKey,
      dirty: true,
    })
    this.rebuildMetricOrder()
    this.options.onDiagnostic('measurement.cache.invalidate', 'info', {
      invalidated: 1,
      reason: 'identity-remap',
      previousKey,
      nextKey,
    })
  }

  getTop(key: MessageRuntimeItemKey): number | undefined {
    return this.rowMetricsByKey.get(key)?.top
  }

  getProjectedTop(
    key: MessageRuntimeItemKey,
    snapshot: ReturnType<RuntimeDomRegistry['snapshot']>,
  ): number | undefined {
    const record = this.rowMetricsByKey.get(key)
    const container = snapshot.scrollContainer

    if (!record || !container) {
      return record?.top
    }

    return projectMetric(record, container.scrollTop, container.getBoundingClientRect().top).top
  }

  record(
    snapshot: ReturnType<RuntimeDomRegistry['snapshot']>,
    measurement?: RuntimeMeasurement,
    context?: RuntimeMeasurementCacheContext,
  ): void {
    const widthBucket = resolveWidthBucket(snapshot)

    if (widthBucket !== this.widthBucket) {
      this.widthBucket = widthBucket
      this.markAllDirty('width')
    }

    const measuredMetrics = createMetricsFromMeasurement(
      snapshot,
      measurement,
      context,
      widthBucket,
    )
    const shouldFullReconcile = !measurement || !measurement.requestedRowCount
    const metrics = measuredMetrics ?? readFullMetrics(snapshot, context, widthBucket)
    const previousKeys = new Set(this.rowMetricsByKey.keys())
    const dirtyKeys = new Set(context?.dirtyKeys ?? [])
    let hits = 0
    let misses = 0

    for (const metric of metrics) {
      const previous = this.rowMetricsByKey.get(metric.key)
      const renderVersionChanged = previous
        ? previous.renderVersion !== metric.renderVersion
        : false
      const dirty = previous?.dirty || dirtyKeys.has(metric.key) || renderVersionChanged

      if (previous && !dirty) {
        hits += 1
      } else {
        misses += 1
      }

      previousKeys.delete(metric.key)
      this.rowMetricsByKey.set(metric.key, {
        ...metric,
        dirty: false,
      })
    }

    if (shouldFullReconcile) {
      for (const key of previousKeys) {
        this.rowMetricsByKey.delete(key)
      }
    }

    this.rebuildMetricOrder()
    this.emitMeasurementCacheDiagnostics({
      hits,
      misses,
      invalidated: shouldFullReconcile ? previousKeys.size : 0,
      rowCount: snapshot.rows.size,
      measuredRows: metrics.length,
      source: context?.source ?? 'transaction',
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

    const viewportStart = container.scrollTop
    const viewportEnd = viewportStart + container.clientHeight
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
      if (metric.contentTop > viewportEnd) {
        break
      }

      visibleKeys.push(metric.key)
      visibleEndIndex = index + 1

      if (visibleKeys.length >= limit) {
        return visibleKeys
      }
    }

    if (visibleKeys.length === 0) {
      const keys = collectMetricWindow(this.rowMetricOrder, sampleStart, sampleEnd, limit)
      return keys.length > 0 ? keys : undefined
    }

    for (
      let index = visibleStartIndex - 1;
      index >= 0 && visibleKeys.length + nearKeys.length < limit;
      index -= 1
    ) {
      const metric = this.rowMetricOrder[index]
      if (metric.contentBottom < sampleStart) {
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
      if (metric.contentTop > sampleEnd) {
        break
      }
      nearKeys.push(metric.key)
    }

    return [...visibleKeys, ...nearKeys].slice(0, limit)
  }

  createSizeSnapshot(input: {
    sessionId: string
    generation: number
    segmentRevision: number
    anchor?: { key: MessageRuntimeItemKey; offsetWithinMessage: number }
  }): RuntimeSegmentSizeSnapshot {
    return {
      sessionId: input.sessionId,
      generation: input.generation,
      segmentRevision: input.segmentRevision,
      widthBucket: this.widthBucket,
      rows: this.rowMetricOrder
        .filter((record) =>
          record.generation === input.generation &&
          record.segmentRevision === input.segmentRevision &&
          !record.dirty,
        )
        .map((record) => ({
          key: record.key,
          height: record.height,
          renderVersion: record.renderVersion,
        })),
      anchor: input.anchor,
    }
  }

  private rebuildMetricOrder(): void {
    this.rowMetricOrder = Array.from(this.rowMetricsByKey.values())
      .sort((first, second) => first.contentTop - second.contentTop)
  }

  private emitMeasurementCacheDiagnostics(input: {
    hits: number
    misses: number
    invalidated: number
    rowCount: number
    measuredRows: number
    source: RuntimeMeasurementSource
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
    const scrollTop = measurement?.scrollTop ?? container.scrollTop
    const firstRecord = this.rowMetricOrder[0]
    const lastRecord = this.rowMetricOrder.at(-1)
    const first = firstRecord
      ? projectMetric(firstRecord, scrollTop, containerRect.top)
      : null
    const last = lastRecord
      ? projectMetric(lastRecord, scrollTop, containerRect.top)
      : null
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
  measurement: RuntimeMeasurement | undefined,
  context: RuntimeMeasurementCacheContext | undefined,
  widthBucket: number,
): RuntimeRowSizeRecord[] | null {
  if (!measurement) {
    return null
  }

  const metrics: RuntimeRowSizeRecord[] = []

  for (const row of measurement.visibleRows) {
    const element = snapshot.rows.get(row.key)

    if (!element) {
      return null
    }

    metrics.push({
      key: row.key,
      top: row.top,
      bottom: row.bottom,
      height: row.bottom - row.top,
      contentTop: row.top - measurement.viewportTop + measurement.scrollTop,
      contentBottom: row.bottom - measurement.viewportTop + measurement.scrollTop,
      widthBucket,
      renderVersion: readRenderVersion(element),
      generation: context?.generation ?? 0,
      segmentRevision: context?.segmentRevision ?? 0,
      projectionRevision: context?.projectionRevision ?? 0,
      dirty: false,
      source: context?.source ?? 'transaction',
    })
  }

  return metrics
}

function readFullMetrics(
  snapshot: ReturnType<RuntimeDomRegistry['snapshot']>,
  context: RuntimeMeasurementCacheContext | undefined,
  widthBucket: number,
): RuntimeRowSizeRecord[] {
  return Array.from(snapshot.rows, ([key, row]) => {
    const rect = row.getBoundingClientRect()
    const container = snapshot.scrollContainer
    const viewportTop = container?.getBoundingClientRect().top ?? 0
    const scrollTop = container?.scrollTop ?? 0
    return {
      key,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      contentTop: rect.top - viewportTop + scrollTop,
      contentBottom: rect.bottom - viewportTop + scrollTop,
      widthBucket,
      renderVersion: readRenderVersion(row),
      generation: context?.generation ?? 0,
      segmentRevision: context?.segmentRevision ?? 0,
      projectionRevision: context?.projectionRevision ?? 0,
      dirty: false,
      source: context?.source ?? 'transaction',
    }
  })
}

function readRenderVersion(row: HTMLElement): number {
  const raw = row.dataset.messageRenderVersion
  const value = raw ? Number(raw) : 0

  return Number.isFinite(value) ? value : 0
}

function resolveWidthBucket(
  snapshot: ReturnType<RuntimeDomRegistry['snapshot']>,
): number {
  return Math.round(snapshot.scrollContainer?.clientWidth ?? 0)
}

function projectMetric(
  metric: RuntimeRowSizeRecord,
  scrollTop: number,
  viewportTop: number,
): RuntimeRowSizeRecord {
  return {
    ...metric,
    top: viewportTop + metric.contentTop - scrollTop,
    bottom: viewportTop + metric.contentBottom - scrollTop,
  }
}

function collectMetricWindow(
  metrics: RuntimeRowSizeRecord[],
  start: number,
  end: number,
  limit: number,
): MessageRuntimeItemKey[] {
  const keys: MessageRuntimeItemKey[] = []
  const firstIndex = findFirstMetricEndingAfter(metrics, start)

  for (let index = firstIndex; index < metrics.length; index += 1) {
    const metric = metrics[index]
    if (metric.contentTop > end || keys.length >= limit) {
      break
    }
    keys.push(metric.key)
  }

  return keys
}

function findFirstMetricEndingAfter(
  metrics: RuntimeRowSizeRecord[],
  threshold: number,
): number {
  let low = 0
  let high = metrics.length

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (metrics[mid].contentBottom < threshold) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}
