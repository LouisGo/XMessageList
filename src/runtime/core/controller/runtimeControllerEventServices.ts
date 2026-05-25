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
import type { RuntimeEventHub } from '../events/runtimeEventHub'

type RuntimeControllerEventServicesInput<TMessage, TOptimistic> = {
  scheduler: RuntimeScheduler
  lifecycle: LifecycleGuard
  registry: DomRegistry
  store: ProjectionStore<TMessage, TOptimistic>
  eventHub: RuntimeEventHub
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
    hasViewportObservationListeners: () =>
      input.eventHub.hasViewportObservationListeners(),
    emitViewportObservation: (event) =>
      input.eventHub.emitViewportObservation(event),
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
  input.eventHub.setViewportObservationResetter(() => observationEvents.reset())

  return {
    anchorEvents,
    observationEvents,
  }
}
