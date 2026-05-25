import { RuntimeViewportAnchorEvents } from './runtimeViewportAnchorEvents'
import { RuntimeViewportObservationEvents } from './runtimeViewportObservationEvents'
import type { DomRegistry } from '../../dom/domRegistry'
import type { ProjectionStore } from '../state/projectionStore'
import type { LifecycleGuard } from '../state/lifecycleGuard'
import type {
  RuntimeScheduler,
  ViewportTransactionKind,
} from '../../types'
import type { RuntimeControllerHost } from './runtimeControllerHost'

type RuntimeControllerEventServicesInput<TMessage, TOptimistic> = {
  scheduler: RuntimeScheduler
  lifecycle: LifecycleGuard
  registry: DomRegistry
  store: ProjectionStore<TMessage, TOptimistic>
  host: RuntimeControllerHost<TMessage, TOptimistic>
  getActiveTransactionKind: () => ViewportTransactionKind | null
  scheduleScrollbarDragEdgeRecheck: (reason: string) => void
}

export function createRuntimeControllerEventServices<TMessage, TOptimistic>(
  input: RuntimeControllerEventServicesInput<TMessage, TOptimistic>,
) {
  const observationEvents = new RuntimeViewportObservationEvents({
    registry: input.registry,
    store: input.store,
    getDataSnapshot: input.host.getDataSnapshot,
    getLastScrollSource: input.host.getLastScrollSource,
    captureViewportAnchor: input.host.captureViewportAnchor,
    emitEvent: input.host.emitEvent,
  })
  const anchorEvents = new RuntimeViewportAnchorEvents({
    scheduler: input.scheduler,
    lifecycle: input.lifecycle,
    getDataSnapshot: input.host.getDataSnapshot,
    getState: input.host.getState,
    getActiveTransactionKind: input.getActiveTransactionKind,
    captureViewportAnchor: input.host.captureViewportAnchor,
    scheduleScrollbarDragEdgeRecheck: input.scheduleScrollbarDragEdgeRecheck,
    emitViewportObservationChanged: (reason) =>
      observationEvents.emitChanged(reason),
    resetViewportObservation: () => observationEvents.reset(),
    emitEvent: input.host.emitEvent,
  })

  return {
    anchorEvents,
    observationEvents,
  }
}
