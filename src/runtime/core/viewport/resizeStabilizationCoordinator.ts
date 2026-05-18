import type { HeightDelta, MeasurementEngine } from '../../dom/measurementEngine'
import type { DomRegistry } from '../../dom/domRegistry'
import type { LifecycleGuard } from '../state/lifecycleGuard'
import type { ProjectionStore } from '../state/projectionStore'
import type { RenderWindowEngine } from '../../window/renderWindowEngine'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { SpacerEngine } from '../../window/spacerEngine'
import type { TransactionRunner } from '../../transactions/transactionRunner'
import type { ViewportTransactionController } from '../../transactions/viewportTransactionController'
import type { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import type {
  AnchorState,
  MessageDataSnapshot,
  RuntimeObserverFactory,
  RuntimeScheduler,
  ViewportAnchorChangeReason,
} from '../../types'
import type {
  ContainerSize,
  RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'

export type ResizeStabilizationDeps<TMessage, TOptimistic> = {
  scheduler: RuntimeScheduler
  observerFactory: RuntimeObserverFactory
  registry: DomRegistry
  lifecycle: LifecycleGuard
  store: ProjectionStore<TMessage, TOptimistic>
  measurement: MeasurementEngine
  spacer: SpacerEngine
  motion: DestinationMotionCoordinator<TMessage, TOptimistic>
  scrollIntent: ScrollIntentEngine
  renderWindow: RenderWindowEngine
  transactions: TransactionRunner
  transactionController: ViewportTransactionController<TMessage, TOptimistic>
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  getCurrentFrame: () => number
  setCurrentFrame: (frame: number) => void
  getLastContainerSize: () => ContainerSize | null
  setLastContainerSize: (size: ContainerSize | null) => void
  captureViewportAnchor: () => AnchorState | null
  emitViewportAnchorChanged: (
    reason: ViewportAnchorChangeReason,
    anchor?: AnchorState | null,
  ) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class ResizeStabilizationCoordinator<TMessage, TOptimistic> {
  private stabilizationRaf: number | null = null

  private resizeRaf: number | null = null

  private containerResizeObserver: ResizeObserver | null = null

  constructor(
    private readonly deps: ResizeStabilizationDeps<TMessage, TOptimistic>,
  ) {}

  setupContainerObserver(container: HTMLElement): void {
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver =
      this.deps.observerFactory.createResizeObserver(() => {
        this.scheduleResizeRaf()
      })
    this.containerResizeObserver?.observe(container)
  }

  disconnectContainerObserver(): void {
    this.containerResizeObserver?.disconnect()
    this.containerResizeObserver = null
  }

  scheduleHeightStabilization(): void {
    if (this.stabilizationRaf !== null) {
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    this.stabilizationRaf = this.deps.scheduler.requestAnimationFrame(() => {
      this.stabilizationRaf = null
      this.incrementFrame()

      if (!this.deps.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      this.stabilizeDirtyHeights()
    })
  }

  cancelScheduledWork(): void {
    if (this.stabilizationRaf !== null) {
      this.deps.scheduler.cancelAnimationFrame(this.stabilizationRaf)
      this.stabilizationRaf = null
    }

    if (this.resizeRaf !== null) {
      this.deps.scheduler.cancelAnimationFrame(this.resizeRaf)
      this.resizeRaf = null
    }
  }

  private stabilizeDirtyHeights(): void {
    const data = this.deps.getDataSnapshot()
    const container = this.deps.registry.getContainer()

    if (!data || !container) {
      return
    }

    const deltas = this.deps.measurement.flushPendingHeightDeltas(
      this.deps.store.getSnapshot().revision,
      container.clientWidth,
    )

    if (deltas.length === 0) {
      return
    }

    const totalDelta = deltas.reduce((total, delta) => total + delta.delta, 0)
    this.deps.spacer.invalidateEstimateCache()

    if (this.deps.motion.isActive()) {
      // motion 期间高度变化会改变目的地坐标，先取消再按当前 anchor/bottom lock 恢复。
      this.deps.motion.cancel('resize-during-motion')
    }

    if (
      this.deps.scrollIntent.getBottomLockState() === 'LOCKED' &&
      !data.hasMoreAfter
    ) {
      this.emitHeightStabilized(data, deltas, totalDelta, {
        deltaAboveAnchor: null,
        anchor: null,
        action: 'scroll-to-bottom',
      })
      this.deps.motion.scrollToBottom('programmatic')
      this.deps.emitViewportAnchorChanged('transaction-settle')
      return
    }

    const anchor = this.deps.captureViewportAnchor()

    if (!anchor) {
      this.deps.emitDiagnostic({
        channel: 'anchor',
        severity: 'warn',
        name: 'anchor.captureMissing',
        correlationId:
          `data:${data.feedId}:${data.generation}:${this.deps.store.getSnapshot().revision}`,
        details: () => ({
          reason: 'height-stabilization',
          deltaCount: deltas.length,
          totalDelta,
        }),
      })
      return
    }

    const anchorIndex = this.deps.renderWindow.findIndexByKey(
      data.items,
      anchor.key,
    )
    const deltaAboveAnchor = deltas.reduce((total, delta) => {
      const deltaIndex = this.deps.renderWindow.findIndexByKey(
        data.items,
        delta.key,
      )
      return deltaIndex >= 0 && deltaIndex < anchorIndex
        ? total + delta.delta
        : total
    }, 0)

    this.emitHeightStabilized(data, deltas, totalDelta, {
      deltaAboveAnchor,
      anchor,
    })

    if (Math.abs(deltaAboveAnchor) > 0.5) {
      this.deps.motion.writeScrollTop(
        container.scrollTop + deltaAboveAnchor,
        'recovery',
      )
    }

    this.deps.emitViewportAnchorChanged('transaction-settle', anchor)
  }

  private scheduleResizeRaf(): void {
    if (this.resizeRaf !== null) {
      return
    }

    const token = this.deps.lifecycle.getCurrent()
    this.resizeRaf = this.deps.scheduler.requestAnimationFrame(() => {
      this.resizeRaf = null
      this.incrementFrame()

      if (!this.deps.lifecycle.isCurrent(token.feedId, token.generation)) {
        return
      }

      const container = this.deps.registry.getContainer()
      const data = this.deps.getDataSnapshot()

      if (
        !container ||
        !data ||
        this.deps.store.getSnapshot().bootstrapState === 'INITIAL'
      ) {
        return
      }

      const previousSize =
        this.deps.getLastContainerSize() ?? readContainerSize(container)
      const nextSize = readContainerSize(container)

      this.deps.setLastContainerSize(nextSize)

      if (
        previousSize.width === nextSize.width &&
        previousSize.height === nextSize.height
      ) {
        return
      }

      this.deps.transactions.enqueue(
        'resize',
        () =>
          this.deps.transactionController.runContainerResizeTransaction(
            previousSize,
            nextSize,
          ),
        'resize',
      )
    })
  }

  private emitHeightStabilized(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    deltas: HeightDelta[],
    totalDelta: number,
    input: {
      deltaAboveAnchor: number | null
      anchor: AnchorState | null
      action?: 'scroll-to-bottom'
    },
  ): void {
    this.deps.emitDiagnostic({
      channel: 'measurement',
      severity: 'info',
      name: 'measurement.heightStabilized',
      correlationId:
        `data:${data.feedId}:${data.generation}:${this.deps.store.getSnapshot().revision}`,
      details: () => ({
        deltaCount: deltas.length,
        totalDelta,
        deltaAboveAnchor: input.deltaAboveAnchor,
        anchorKey: input.anchor?.key ?? null,
        bottomLockState: this.deps.scrollIntent.getBottomLockState(),
        action: input.action,
      }),
    })
  }

  private incrementFrame(): void {
    this.deps.setCurrentFrame(this.deps.getCurrentFrame() + 1)
  }
}

function readContainerSize(container: HTMLElement): ContainerSize {
  return {
    width: container.clientWidth,
    height: container.clientHeight,
  }
}
