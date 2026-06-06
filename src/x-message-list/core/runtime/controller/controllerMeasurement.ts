import type { MessageIdentityAnchor, MessageRuntimeItemKey } from '../contracts/identity'
import type { RuntimeScheduler } from '../contracts/options'
import type { LoadedSegment } from '../contracts/segment'
import type { MessageListSnapshot } from '../contracts/snapshot'
import type { RuntimeDomInteractions } from '../dom/domInteractions'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeDirtyRange, RuntimeDirtyRangeRegistry } from '../dom/dirtyRange'
import { captureVisualAnchor, measureRuntimeDom, type RuntimeMeasurement, type VisualAnchor } from '../dom/measurement'
import type { RuntimeSegmentSizeSnapshot } from '../dom/rowMetricCache'
import type { RuntimeInteractionState, RuntimeEdge } from '../interactions/interactionState'
import type { RuntimeScrollIntentCoordinator } from '../scroll/runtimeScrollIntent'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'
import type { ControllerMotionCoordinator } from './controllerMotionCoordinator'
import type { ProjectionTransactionQueue } from './transactionQueue'
import { findKeyForAnchor } from '../shared/snapshotIdentity'

export type RuntimeMeasurementSource = 'transaction' | 'transaction-precheck' | 'transaction-final' | 'resize' | 'scroll-sample'

type PushDiagnostic = (name: string, severity: import('../contracts/events').ViewportDiagnosticRecord['severity'], details: Record<string, unknown>) => void

export type RuntimeControllerMeasurementHost<TMessage, TOptimistic> = {
  scheduler: RuntimeScheduler
  registry: RuntimeDomRegistry
  domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>
  dirtyRange: RuntimeDirtyRangeRegistry
  rowKeyByElement: Map<HTMLElement, MessageRuntimeItemKey>
  resizeFrame: number | null
  scrollIntent: RuntimeScrollIntentCoordinator
  motion: ControllerMotionCoordinator<TMessage, TOptimistic>
  transactions: ProjectionTransactionQueue<TMessage, TOptimistic>
  stateAxes: RuntimeStateAxes
  interactions: RuntimeInteractionState<TMessage, TOptimistic>
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  lastMeasurement: RuntimeMeasurement
  lastAnchor: MessageIdentityAnchor | null
  lastAnchorOffsetWithinMessage: number | undefined
  setViewportPhase(phase: MessageListSnapshot['viewportPhase']): void
  scheduleResizeMeasurement(): void
  emitViewportObservation: (reason: import('../contracts/events').ViewportObservationReason, scrollSource?: ReturnType<RuntimeScrollIntentCoordinator['getLastScrollSource']>, input?: unknown) => void
  emitAnchorChanged: (reason: import('../contracts/events').ViewportAnchorChangedEvent['reason'], input: unknown) => void
  emitSnapshot(): void
  resolveMeasuredViewportAnchor(): unknown
  applyPostCommitInteractionUpdates(directScrollEdgeIntent?: RuntimeEdge | null): void
  pushDiagnostic: PushDiagnostic
}

export function handleResizeEntries<TMessage, TOptimistic>(host: RuntimeControllerMeasurementHost<TMessage, TOptimistic>, entries: ResizeObserverEntry[]): void {
  let unknown = false

  for (const entry of entries) {
    const key = host.rowKeyByElement.get(entry.target as HTMLElement)

    if (!key) {
      unknown = true
      continue
    }

    host.dirtyRange.markDirty(key, 'resize')
    host.domInteractions.markRowMetricDirty(key)
  }

  if (unknown) {
    host.dirtyRange.markAllDirty('unknown')
    host.domInteractions.markAllRowMetricsDirty('unknown')
  }
}

export function markSegmentDirty<TMessage, TOptimistic>(segment: LoadedSegment<TMessage, TOptimistic>, host: RuntimeControllerMeasurementHost<TMessage, TOptimistic>): void {
  switch (segment.modifier.type) {
    case 'bootstrap':
    case 'reset-latest':
    case 'reset-around':
    case 'trim-before':
    case 'trim-after':
      host.dirtyRange.markAllDirty('segment')
      host.domInteractions.markAllRowMetricsDirty('segment')
      break
    case 'extend-before':
    case 'extend-after': {
      const keys = segment.items.map((item) => item.key)
      host.dirtyRange.markDirtyKeys(keys, 'segment')
      host.domInteractions.markRowMetricDirtyKeys(keys)
      break
    }
    case 'patch':
      host.dirtyRange.markDirtyKeys(segment.modifier.changedKeys, 'render-version')
      host.domInteractions.markRowMetricDirtyKeys(segment.modifier.changedKeys)
      break
    case 'append':
      host.dirtyRange.markDirtyKeys(segment.modifier.changedKeys, 'segment')
      host.domInteractions.markRowMetricDirtyKeys(segment.modifier.changedKeys)
      for (const retired of segment.modifier.retireKeys ?? []) {
        host.domInteractions.deleteRowMetric(retired)
        host.dirtyRange.deleteKey(retired)
      }
      break
    case 'identity-remap':
      for (const remap of segment.modifier.remaps) {
        host.dirtyRange.markDirty(remap.nextKey, 'render-version')
        host.domInteractions.remapRowMetric(remap.previousKey, remap.nextKey)
      }
      break
    default:
      host.dirtyRange.markAllDirty('unknown')
      host.domInteractions.markAllRowMetricsDirty('unknown')
  }
}

export function scheduleResizeMeasurementFrame<TMessage, TOptimistic>(host: RuntimeControllerMeasurementHost<TMessage, TOptimistic>): void {
  if (host.resizeFrame !== null) return
  const pushDiagnostic: PushDiagnostic = (name, severity, details) =>
    host.pushDiagnostic(name, severity, details)
  host.resizeFrame = host.scheduler.requestAnimationFrame(() => {
    host.scrollIntent.incrementFrame()
    host.resizeFrame = null
    if (host.snapshot.viewportPhase === 'MOTION') {
      const result = host.motion.handleResizeDuringMotion()
      if (result !== 'inactive' && result !== 'cancelled') return
    }
    if (host.transactions.hasPending() || host.snapshot.viewportPhase !== 'IDLE') {
      host.scheduleResizeMeasurement()
      return
    }
    const dirtyRange = host.dirtyRange.resolve(host.snapshot)
    host.setViewportPhase('MEASURING')
    const captureKeys = resolveResizeCaptureKeys(dirtyRange, host.domInteractions)
    const sampledAnchor = captureVisualAnchor(host.registry.snapshot(), { rowKeys: captureKeys })
    const needsFullFallback = dirtyRange.fallbackFullMeasure || sampledAnchor === null
    const anchor = needsFullFallback
      ? captureVisualAnchor(host.registry.snapshot())
      : sampledAnchor
    const measurementOptions = needsFullFallback
      ? {}
      : resolveResizeMeasurementOptions(dirtyRange, captureKeys, anchor)
    host.lastMeasurement = measureRuntimeDom(host.registry.snapshot(), measurementOptions)
    emitMeasurementDiagnostics(pushDiagnostic, host.lastMeasurement, 'resize', dirtyRange)
    host.setViewportPhase('CORRECTING')
    if (shouldPreserveAnchorForDirtyRange(dirtyRange, anchor, host.snapshot)) {
      host.domInteractions.preserveVisualAnchor(anchor)
    }
    host.lastMeasurement = measureRuntimeDom(host.registry.snapshot(), measurementOptions)
    emitMeasurementDiagnostics(pushDiagnostic, host.lastMeasurement, 'resize', dirtyRange)
    host.domInteractions.recordRowMetrics(
      host.lastMeasurement,
      createMeasurementCacheContext(host.snapshot, 'resize', dirtyRange),
    )
    if (!needsFullFallback) {
      host.domInteractions.invalidateRowMetricsAfterIndex(
        host.snapshot,
        dirtyRange.firstIndex,
        'resize-suffix',
      )
    }
    host.dirtyRange.clear()
    host.stateAxes.markTransactionSettling()
    host.pushDiagnostic('measurement.resize.dirtyKeys', 'info', {
      rowCount: host.lastMeasurement.visibleRows.length,
      dirtyKeyCount: dirtyRange.keys.size,
      firstIndex: dirtyRange.firstIndex,
      lastIndex: dirtyRange.lastIndex,
      fallbackFullMeasure: dirtyRange.fallbackFullMeasure,
      reason: dirtyRange.reason,
    })
    if (needsFullFallback || host.lastMeasurement.fallbackFullMeasure) {
      host.pushDiagnostic('measurement.resize.fallbackFullMeasure', 'warn', {
        missingKeys: dirtyRange.missingKeys.length,
        reason: sampledAnchor === null ? 'anchor-missing' : dirtyRange.reason,
      })
    }
    host.setViewportPhase('IDLE')
    host.emitViewportObservation('resize')
    host.applyPostCommitInteractionUpdates()
  })
}

export function handleScrollFrame<TMessage, TOptimistic>(host: RuntimeControllerMeasurementHost<TMessage, TOptimistic>): void {
  if (host.transactions.hasPending() || host.snapshot.viewportPhase !== 'IDLE') return
  const pushDiagnostic: PushDiagnostic = (name, severity, details) =>
    host.pushDiagnostic(name, severity, details)
  const previousScrollTop = host.lastMeasurement.scrollTop
  const scrollSource = host.scrollIntent.classifyFrameScroll()
  host.lastMeasurement = measureRuntimeDom(host.registry.snapshot(), {
    rowKeys: host.domInteractions.getScrollSampleKeys(),
  })
  emitMeasurementDiagnostics(pushDiagnostic, host.lastMeasurement, 'scroll-sample')
  host.domInteractions.recordRowMetrics(
    host.lastMeasurement,
    createMeasurementCacheContext(host.snapshot, 'scroll-sample'),
  )
  host.snapshot = host.interactions.updateActiveFollowBottomForScroll(
    host.snapshot,
    host.lastMeasurement.scrollTop,
    scrollSource,
  )
  const bottomLockUpdate = host.scrollIntent.updateBottomLock(
    host.snapshot,
    host.lastMeasurement,
    scrollSource,
    previousScrollTop,
  )
  host.snapshot = bottomLockUpdate.snapshot
  if (bottomLockUpdate.changed) {
    host.emitSnapshot()
  }
  host.emitViewportObservation('scroll-idle', scrollSource)
  host.emitAnchorChanged('scroll-idle', host.resolveMeasuredViewportAnchor())
}

export function createMeasurementCacheContext<TMessage, TOptimistic>(
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  source: RuntimeMeasurementSource,
  dirtyRange?: RuntimeDirtyRange,
) {
  return {
    generation: snapshot.generation,
    segmentRevision: snapshot.segmentRevision,
    projectionRevision: snapshot.projectionRevision,
    source,
    dirtyKeys: dirtyRange?.keys ?? undefined,
  }
}

export function emitMeasurementDiagnostics(
  pushDiagnostic: PushDiagnostic,
  measurement: RuntimeMeasurement,
  source: RuntimeMeasurementSource,
  dirtyRange?: RuntimeDirtyRange,
): void {
  pushDiagnostic('measurement.rectRead.count', 'debug', {
    source,
    rectReadCount: measurement.rectReadCount,
    rowCount: measurement.visibleRows.length,
    requestedRowCount: measurement.requestedRowCount,
    fallbackFullMeasure: measurement.fallbackFullMeasure,
  })
  pushDiagnostic('measurement.rectRead.rows', 'debug', {
    source,
    rectReadRows: measurement.rectReadRows,
    dirtyKeyCount: dirtyRange?.keys.size ?? 0,
  })
}

export function createSegmentSizeSnapshot<TMessage, TOptimistic>(host: RuntimeControllerMeasurementHost<TMessage, TOptimistic>): RuntimeSegmentSizeSnapshot {
  const anchorKey = host.lastAnchor
    ? findKeyForAnchor(host.snapshot, host.lastAnchor)
    : null

  return host.domInteractions.createSizeSnapshot({
    sessionId: host.snapshot.sessionId,
    generation: host.snapshot.generation,
    segmentRevision: host.snapshot.segmentRevision,
    anchor: anchorKey
      ? {
          key: anchorKey,
          offsetWithinMessage: host.lastAnchorOffsetWithinMessage ?? 0,
        }
      : undefined,
  })
}

function resolveResizeCaptureKeys<TMessage, TOptimistic>(dirtyRange: RuntimeDirtyRange, domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>): string[] | undefined {
  if (dirtyRange.fallbackFullMeasure || dirtyRange.keys.size === 0) {
    return domInteractions.getScrollSampleKeys()
  }

  const keys = new Set<string>()
  for (const key of dirtyRange.keys) keys.add(key)
  for (const key of domInteractions.getScrollSampleKeys() ?? []) keys.add(key)
  return [...keys]
}

function resolveResizeMeasurementOptions(
  dirtyRange: RuntimeDirtyRange,
  captureKeys: string[] | undefined,
  anchor: VisualAnchor | null,
): { rowKeys?: string[] } {
  if (!anchor || dirtyRange.fallbackFullMeasure || !captureKeys || captureKeys.length === 0) {
    return {}
  }
  const keys = new Set(captureKeys)
  keys.add(anchor.key)
  return { rowKeys: [...keys] }
}

function shouldPreserveAnchorForDirtyRange<TMessage, TOptimistic>(
  dirtyRange: RuntimeDirtyRange,
  anchor: VisualAnchor | null,
  snapshot: MessageListSnapshot<TMessage, TOptimistic>,
): boolean {
  if (!anchor || dirtyRange.fallbackFullMeasure) return true
  if (dirtyRange.keys.has(anchor.key)) return true
  if (dirtyRange.firstIndex === null) return false
  return dirtyRange.firstIndex <= resolveAnchorIndex(snapshot, anchor.key)
}

function resolveAnchorIndex<TMessage, TOptimistic>(snapshot: MessageListSnapshot<TMessage, TOptimistic>, key: MessageRuntimeItemKey): number {
  return snapshot.items.findIndex((item) => item.key === key)
}
