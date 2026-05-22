import { DomRegistry } from '../../dom/domRegistry'
import { MeasurementEngine } from '../../dom/measurementEngine'
import {
  ProjectionStore,
  createEmptySnapshot,
} from '../state/projectionStore'
import { RenderWindowEngine } from '../../window/renderWindowEngine'
import { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import { SpacerEngine } from '../../window/spacerEngine'
import { CommitCoordinator } from '../projection/commitCoordinator'
import { ProjectionCoordinator } from '../projection/projectionCoordinator'
import { RuntimeEventHub } from '../events/runtimeEventHub'
import { DiagnosticRecorder } from '../../debug/diagnosticRecorder'
import { LifecycleGuard } from '../state/lifecycleGuard'
import {
  DEFAULT_EDGE_LOAD_THRESHOLD_PX,
  DEFAULT_SCROLL_MOTION_OPTIONS,
  DEFAULT_VIEWPORT_COMPACTION_SPACER_THRESHOLD_PX,
} from '../state/runtimeTypes'
import type {
  MessageViewportRuntimeOptions,
  RuntimeObserverFactory,
  ScrollMotionOptions,
} from '../../types'
import {
  DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
  DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
  createDefaultObserverFactory,
  createDefaultScheduler,
  mergeWindowConfig,
} from '../../shared/utils'
import type { RuntimeControllerHost } from './runtimeControllerHost'

export function createRuntimeControllerBaseServices<TMessage, TOptimistic>(
  options: MessageViewportRuntimeOptions,
  host: RuntimeControllerHost<TMessage, TOptimistic>,
  scheduleHeightStabilization: () => void,
) {
  const feedId = options.feedId ?? ''
  const generation = options.generation ?? 0
  const defaultObservers = createDefaultObserverFactory()
  const config = mergeWindowConfig(options.window)
  const scheduler = options.scheduler ?? createDefaultScheduler()
  const observerFactory: RuntimeObserverFactory = {
    createResizeObserver:
      options.observers?.createResizeObserver ??
      defaultObservers.createResizeObserver,
    createIntersectionObserver:
      options.observers?.createIntersectionObserver ??
      defaultObservers.createIntersectionObserver,
  }
  const commitTimeoutMs = {
    bootstrap: options.commitTimeoutMs?.bootstrap ?? 1000,
    normal: options.commitTimeoutMs?.normal ?? 500,
    jump: options.commitTimeoutMs?.jump ?? 800,
  }
  const scrollMotionOptions: Required<ScrollMotionOptions> = {
    ...DEFAULT_SCROLL_MOTION_OPTIONS,
    ...options.scrollMotion,
  }
  const edgeLoadThresholdPx =
    options.edgeLoadThresholdPx ?? DEFAULT_EDGE_LOAD_THRESHOLD_PX
  const viewportCompactionSpacerThresholdPx =
    normalizeViewportCompactionSpacerThresholdPx(
      options.viewportCompaction?.spacerThresholdPx,
    )
  const diagnostics = new DiagnosticRecorder(
    options.debug?.diagnostics,
    () => scheduler.now(),
    host.getDiagnosticContext,
    host.emitEvent,
  )
  const store = new ProjectionStore(
    createEmptySnapshot<TMessage, TOptimistic>(feedId, generation),
  )
  const registry = new DomRegistry()
  const lifecycle = new LifecycleGuard(feedId, generation)
  const spacer = new SpacerEngine(host.heightCache)
  const renderWindow = new RenderWindowEngine(config, spacer)
  const measurement = new MeasurementEngine(
    host.heightCache,
    observerFactory,
    scheduleHeightStabilization,
  )
  const scrollIntent = new ScrollIntentEngine(
    options.bottomLockThresholdPx ?? DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
    options.bottomUnlockThresholdPx ?? DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
  )
  const eventHub = new RuntimeEventHub({
    eventListeners: host.eventListeners,
    emitDiagnostic: host.emitDiagnostic,
    getCurrentToken: () => lifecycle.getCurrent(),
    captureViewportAnchor: host.captureViewportAnchor,
  })
  const projection = new ProjectionCoordinator(
    store,
    registry,
    spacer,
    host.emitDiagnostic,
  )
  const commit = new CommitCoordinator(
    scheduler,
    commitTimeoutMs,
    host.emitError,
  )

  return {
    config,
    scheduler,
    observerFactory,
    store,
    registry,
    lifecycle,
    spacer,
    renderWindow,
    measurement,
    scrollIntent,
    eventHub,
    projection,
    commit,
    scrollMotionOptions,
    edgeLoadThresholdPx,
    viewportCompactionSpacerThresholdPx,
    diagnostics,
  }
}

function normalizeViewportCompactionSpacerThresholdPx(
  threshold: number | undefined,
): number {
  if (
    typeof threshold === 'number' &&
    Number.isFinite(threshold) &&
    threshold >= 0
  ) {
    return threshold
  }

  return DEFAULT_VIEWPORT_COMPACTION_SPACER_THRESHOLD_PX
}
