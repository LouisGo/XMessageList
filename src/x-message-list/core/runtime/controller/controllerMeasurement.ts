import type { MessageIdentityAnchor, MessageRuntimeItemKey } from '../contracts/identity'
import type { RuntimeScheduler } from '../contracts/options'
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
import { emitMeasurementDiagnostics, type PushDiagnostic } from './controllerMeasurementDiagnostics'

export type RuntimeMeasurementSource = 'transaction' | 'transaction-precheck' | 'transaction-final' | 'resize' | 'scroll-sample'

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

export function scheduleResizeMeasurementFrame<TMessage, TOptimistic>(host: RuntimeControllerMeasurementHost<TMessage, TOptimistic>): void {
  if (host.resizeFrame !== null) return
  const pushDiagnostic: PushDiagnostic = (name, severity, details) =>
    host.pushDiagnostic(name, severity, details)
  host.resizeFrame = host.scheduler.requestAnimationFrame(() => {
    host.scrollIntent.incrementFrame()
    host.resizeFrame = null
    if (host.snapshot.viewportPhase === 'MOTION') {
      // motion 期间 resize 只 retarget 动画；避免同时做 anchor correction 造成双重 scrollTop 写入。
      const result = host.motion.handleResizeDuringMotion()
      if (result !== 'inactive' && result !== 'cancelled') return
    }
    if (host.transactions.hasPending() || host.snapshot.viewportPhase !== 'IDLE') {
      // projection/settle 未完成时推迟 resize 测量，保持 commit 流水线单写者。
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
    const shouldFollowNativeBottom = host.snapshot.bottomLockState === 'LOCKED' &&
      !host.snapshot.segmentMeta.hasMoreAfter
    const distanceToBottom = Math.max(
      0,
      host.lastMeasurement.scrollHeight -
        host.lastMeasurement.clientHeight -
        host.lastMeasurement.scrollTop,
    )
    if (shouldFollowNativeBottom && distanceToBottom > 1) {
      host.domInteractions.scrollToNativeBottom('followBottom')
      host.pushDiagnostic('measurement.resize.bottomFollow', 'info', {
        distanceToBottom,
      })
    } else if (
      !shouldFollowNativeBottom &&
      shouldPreserveAnchorForDirtyRange(dirtyRange, anchor, host.snapshot)
    ) {
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
  // scroll idle 只采样视口附近行，避免每帧滚动把全部 DOM row 都读一遍。
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

export function createSegmentSizeSnapshot<TMessage, TOptimistic>(host: RuntimeControllerMeasurementHost<TMessage, TOptimistic>): RuntimeSegmentSizeSnapshot {
  const anchorKey = host.lastAnchor ? findKeyForAnchor(host.snapshot, host.lastAnchor) : null

  return host.domInteractions.createSizeSnapshot({
    sessionId: host.snapshot.sessionId, generation: host.snapshot.generation, segmentRevision: host.snapshot.segmentRevision,
    anchor: anchorKey ? { key: anchorKey, offsetWithinMessage: host.lastAnchorOffsetWithinMessage ?? 0 } : undefined,
  })
}

function resolveResizeCaptureKeys<TMessage, TOptimistic>(dirtyRange: RuntimeDirtyRange, domInteractions: RuntimeDomInteractions<TMessage, TOptimistic>): string[] | undefined {
  if (dirtyRange.fallbackFullMeasure || dirtyRange.keys.size === 0) return domInteractions.getScrollSampleKeys()

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
