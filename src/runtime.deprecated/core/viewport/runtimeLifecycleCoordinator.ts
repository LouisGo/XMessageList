import type { DestinationIntentCoordinator } from '../commands/destinationIntentCoordinator'
import type { RuntimeStateAxes } from '../state/runtimeStateAxes'
import type { ProjectionStore } from '../state/projectionStore'
import type { LifecycleGuard } from '../state/lifecycleGuard'
import type { ResizeStabilizationCoordinator } from './resizeStabilizationCoordinator'
import type { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import type { EdgeNeedCoordinator } from '../../events/edgeNeedCoordinator'
import type { DomRegistry } from '../../dom/domRegistry'
import type { MeasurementEngine } from '../../dom/measurementEngine'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { TransactionRunner } from '../../transactions/transactionRunner'
import type { CommitCoordinator } from '../projection/commitCoordinator'
import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { SpacerEngine, HeightCache } from '../../window/spacerEngine'
import type {
  RuntimeEventListener,
  RuntimeState,
} from '../../types'
import type {
  ContainerSize,
  RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'
import { createEmptySnapshot } from '../state/projectionStore'
import { getDistanceToBottom } from '../../shared/utils'

type RuntimeLifecycleDeps<TMessage, TOptimistic> = {
  registry: DomRegistry
  store: ProjectionStore<TMessage, TOptimistic>
  lifecycle: LifecycleGuard
  transactions: TransactionRunner
  commit: CommitCoordinator<TMessage, TOptimistic>
  resizeStabilization: ResizeStabilizationCoordinator<TMessage, TOptimistic>
  edge: EdgeNeedCoordinator<TMessage, TOptimistic>
  measurement: MeasurementEngine
  motion: DestinationMotionCoordinator<TMessage, TOptimistic>
  scrollIntent: ScrollIntentEngine
  renderWindow: RenderWindowEngine
  spacer: SpacerEngine
  destinationIntent: DestinationIntentCoordinator<TMessage, TOptimistic>
  stateAxes: RuntimeStateAxes
  heightCache: HeightCache
  eventListeners: Set<RuntimeEventListener>
  getState: () => RuntimeState
  setState: (state: RuntimeState) => void
  getCurrentFrame: () => number
  getRetainedScrollTop: () => number | null
  setRetainedScrollTop: (scrollTop: number | null) => void
  setLastScrollSource: (source: null) => void
  setLastUserScrollTop: (scrollTop: number) => void
  setLastUserDistanceToBottom: (distance: number) => void
  setLastContainerSize: (size: ContainerSize | null) => void
  attachDomListeners: (container: HTMLElement) => void
  detachDomListeners: (container: HTMLElement) => void
  cancelScheduledWork: () => void
  readContainerSize: (container: HTMLElement) => ContainerSize
  reconcileReadyBottomLockFromViewport: (reason: string) => boolean
  tryRunPendingBootstrap: () => boolean
  emitViewportAnchorChanged: (reason: 'detach') => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class RuntimeLifecycleCoordinator<TMessage, TOptimistic> {
  constructor(
    private readonly deps: RuntimeLifecycleDeps<TMessage, TOptimistic>,
  ) {}

  attach(container: HTMLElement): void {
    if (this.deps.getState() === 'DESTROYED') {
      return
    }

    const current = this.deps.registry.getContainer()

    if (current === container) {
      return
    }

    if (current) {
      this.detach()
    }

    this.deps.lifecycle.resume()
    this.deps.transactions.resume()
    this.deps.scrollIntent.clearTransientIntent()
    this.deps.scrollIntent.markScrollWrite(
      'programmatic',
      this.deps.getCurrentFrame(),
    )
    this.deps.setLastScrollSource(null)
    this.deps.registry.attachContainer(container)
    // detach/attach 同一个 runtime 实例时保留 scrollTop，feed 切换缓存复用不能闪回顶部。
    container.scrollTop = Math.max(0, this.deps.getRetainedScrollTop() ?? 0)
    this.deps.setLastUserScrollTop(container.scrollTop)
    this.deps.setLastUserDistanceToBottom(getDistanceToBottom(container))
    this.deps.setLastContainerSize(this.deps.readContainerSize(container))
    this.deps.attachDomListeners(container)
    this.deps.resizeStabilization.setupContainerObserver(container)
    this.deps.edge.setupIntersectionObserver(container)
    this.deps.setState(
      this.deps.store.getSnapshot().bootstrapState === 'READY'
        ? 'READY'
        : 'ATTACHED',
    )
    if (this.deps.getState() === 'READY') {
      this.deps.stateAxes.setReadySubstate('READY_IDLE')
    }
    this.deps.emitDiagnostic({
      channel: 'lifecycle',
      severity: 'info',
      name: 'lifecycle.attach',
      details: () => ({
        restoredScrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        clientWidth: container.clientWidth,
        bootstrapState: this.deps.store.getSnapshot().bootstrapState,
      }),
    })
    this.deps.reconcileReadyBottomLockFromViewport('attach')
    this.deps.tryRunPendingBootstrap()
  }

  detach(): void {
    if (this.deps.getState() === 'DESTROYED') {
      return
    }

    const container = this.deps.registry.getContainer()

    this.deps.emitDiagnostic({
      channel: 'lifecycle',
      severity: 'info',
      name: 'lifecycle.detach',
      details: () => ({
        scrollTop: container?.scrollTop ?? null,
        hasContainer: Boolean(container),
      }),
    })
    this.deps.lifecycle.suspend()
    this.clearDestinationIntent('detach')
    this.deps.motion.cancel('detach')
    this.deps.commit.cancelPendingCommit()
    this.deps.cancelScheduledWork()
    this.deps.resizeStabilization.disconnectContainerObserver()
    this.deps.edge.disconnect()
    this.deps.measurement.disconnect()
    this.deps.transactions.clear()

    this.deps.emitViewportAnchorChanged('detach')

    if (container) {
      this.deps.setRetainedScrollTop(container.scrollTop)
      this.deps.detachDomListeners(container)
    }

    this.deps.scrollIntent.clearTransientIntent()
    this.deps.setLastScrollSource(null)
    this.deps.registry.clearDomRefs()
    this.deps.setLastContainerSize(null)
    this.deps.stateAxes.resetReadyIdle()
    this.deps.setState('DETACHED')
  }

  destroy(): void {
    if (this.deps.getState() === 'DESTROYED') {
      return
    }

    this.deps.emitDiagnostic({
      channel: 'lifecycle',
      severity: 'info',
      name: 'lifecycle.destroy',
      details: () => ({
        heightCacheSize: this.deps.heightCache.size,
        observedRows: this.deps.registry.getSnapshot().observedRows,
      }),
    })
    this.detach()
    this.deps.lifecycle.destroy()
    this.deps.transactions.stop()
    this.clearDestinationIntent('destroy')
    this.deps.motion.cancel('destroy')
    this.deps.heightCache.clear()
    this.deps.eventListeners.clear()
    this.deps.store.clearListeners()
    this.deps.setRetainedScrollTop(null)
    this.deps.stateAxes.resetReadyIdle()
    this.deps.setState('DESTROYED')
  }

  resetForGeneration(feedId: string, generation: number): void {
    this.clearDestinationIntent('generation-change')
    this.deps.motion.cancel('generation-change')
    this.deps.lifecycle.reset(feedId, generation)
    this.deps.transactions.clear()
    this.deps.commit.cancelPendingCommit()
    this.deps.cancelScheduledWork()
    this.deps.heightCache.clear()
    this.deps.renderWindow.invalidateIndexCache()
    this.deps.spacer.invalidateEstimateCache()
    this.deps.edge.resetLatches()
    this.deps.setLastScrollSource(null)
    this.deps.scrollIntent.clearTransientIntent()
    this.deps.stateAxes.resetReadyIdle()
    this.deps.scrollIntent.setBottomLockState('UNLOCKED')
    // 先发布空 snapshot，让 React projection 明确切到新 feed，再等待新的 bootstrap。
    this.deps.store.setSnapshot(
      createEmptySnapshot<TMessage, TOptimistic>(feedId, generation),
    )
    this.deps.setState(
      this.deps.registry.getContainer() ? 'ATTACHED' : 'INITIAL',
    )
  }

  private clearDestinationIntent(reason: string): void {
    this.deps.destinationIntent.clearPendingFollowBottom()
    this.deps.destinationIntent.clearActiveFollowBottomIntent(reason)
    this.deps.destinationIntent.clearPendingDestinationRequest()
  }
}
