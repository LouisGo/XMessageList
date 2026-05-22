import type { DomRegistry } from '../../dom/domRegistry'
import type { ProjectionCoordinator } from '../projection/projectionCoordinator'
import type { ProjectionStore } from '../state/projectionStore'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type {
  MessageDataSnapshot,
  RenderWindow,
} from '../../types'
import type { RuntimeDiagnosticEmitter } from '../state/runtimeTypes'
import { readScrollFrameMetrics } from '../viewport/scrollFrameMetrics'

type RuntimeBottomLockDeps<TMessage, TOptimistic> = {
  registry: DomRegistry
  store: ProjectionStore<TMessage, TOptimistic>
  scrollIntent: ScrollIntentEngine
  projection: ProjectionCoordinator<TMessage, TOptimistic>
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  keepCurrentWindow: (
    items: MessageDataSnapshot<TMessage, TOptimistic>['items'],
  ) => RenderWindow
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class RuntimeBottomLockCoordinator<TMessage, TOptimistic> {
  constructor(
    private readonly deps: RuntimeBottomLockDeps<TMessage, TOptimistic>,
  ) {}

  reconcileReadyFromViewport(reason: string): boolean {
    const data = this.deps.getDataSnapshot()

    if (!data || this.deps.store.getSnapshot().bootstrapState !== 'READY') {
      return false
    }

    const changed = this.reconcileFromViewport(data, reason)

    if (changed) {
      this.deps.projection.publish({
        data,
        renderWindow: this.deps.keepCurrentWindow(data.items),
        bootstrapState: this.deps.store.getSnapshot().bootstrapState,
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
      })
    }

    return changed
  }

  reconcileFromViewport(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    reason: string,
  ): boolean {
    const container = this.deps.registry.getContainer()

    if (!container || data.hasMoreAfter) {
      return false
    }

    const metrics = readScrollFrameMetrics(container)
    const previousBottomLockState = this.deps.scrollIntent.getBottomLockState()
    const changed = this.deps.scrollIntent.reconcileBottomLockFromDistance(
      metrics.distanceToBottom,
    )

    if (changed) {
      this.deps.emitDiagnostic({
        channel: 'scroll',
        severity: 'info',
        name: 'scroll.bottomLockReconciled',
        details: () => ({
          reason,
          previousBottomLockState,
          nextBottomLockState: this.deps.scrollIntent.getBottomLockState(),
          scrollTop: metrics.scrollTop,
          scrollHeight: metrics.scrollHeight,
          clientHeight: metrics.clientHeight,
          distanceToBottom: metrics.distanceToBottom,
          hasMoreAfter: data.hasMoreAfter,
        }),
      })
    }

    return changed
  }
}
