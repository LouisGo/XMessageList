import type { MeasurementEngine, HeightDelta } from '../../dom/measurementEngine'
import type { DomRegistry } from '../../dom/domRegistry'
import type { DestinationMotionCoordinator } from '../../scroll/destinationMotionCoordinator'
import type { LifecycleGuard } from '../state/lifecycleGuard'
import type { ProjectionCoordinator } from '../projection/projectionCoordinator'
import type { ProjectionStore } from '../state/projectionStore'
import type { ScrollIntentEngine } from '../../scroll/scrollIntentEngine'
import type { SpacerEngine } from '../../window/spacerEngine'
import type {
  MessageViewportSnapshot,
  RuntimeScheduler,
  RuntimeState,
} from '../../types'
import {
  BOOTSTRAP_HEIGHT_EPSILON_PX,
  BOOTSTRAP_SETTLE_TIMEOUT_MS,
  BOOTSTRAP_STABLE_FRAMES,
  type CommitRecoveryInput,
  type RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'

type RuntimeRecoveryAndMeasurementDeps<TMessage, TOptimistic> = {
  scheduler: RuntimeScheduler
  registry: DomRegistry
  lifecycle: LifecycleGuard
  store: ProjectionStore<TMessage, TOptimistic>
  measurement: MeasurementEngine
  spacer: SpacerEngine
  motion: DestinationMotionCoordinator<TMessage, TOptimistic>
  projection: ProjectionCoordinator<TMessage, TOptimistic>
  scrollIntent: ScrollIntentEngine
  getState: () => RuntimeState
  setState: (state: RuntimeState) => void
  getCurrentFrame: () => number
  setCurrentFrame: (frame: number) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class RuntimeRecoveryAndMeasurement<TMessage, TOptimistic> {
  constructor(
    private readonly deps: RuntimeRecoveryAndMeasurementDeps<
      TMessage,
      TOptimistic
    >,
  ) {}

  // commit 失败恢复只能回到调用方指定的状态和 projection 快照；
  // 这里不重新推断业务意图，避免失败路径触发新的跳转或吸底事务。
  recoverAfterCommitFailure(
    input: CommitRecoveryInput<TMessage, TOptimistic>,
  ): void {
    if (!this.deps.lifecycle.isCurrent(input.token.feedId, input.token.generation)) {
      return
    }

    this.deps.emitDiagnostic({
      channel: 'recovery',
      severity: 'warn',
      name: 'recovery.commitFailure',
      details: () => ({
        token: input.token,
        nextState: input.nextState,
        restoreBottomLockState: input.restoreBottomLockState ?? null,
        hasRestoreSnapshot: Boolean(input.restoreSnapshot),
        hasRestoreProjection: Boolean(input.restoreProjection),
      }),
    })

    this.deps.setState(input.nextState)

    if (typeof input.restoreBottomLockState === 'string') {
      this.deps.scrollIntent.setBottomLockState(input.restoreBottomLockState)
    }

    if (input.restoreSnapshot) {
      this.deps.store.setSnapshot(input.restoreSnapshot)
    } else if (input.restoreProjection) {
      this.deps.projection.publish(input.restoreProjection)
    }
  }

  deriveRuntimeStateFromSnapshot(
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ): RuntimeState {
    if (!this.deps.registry.getContainer()) {
      return 'INITIAL'
    }

    return snapshot.bootstrapState === 'READY' || snapshot.bootstrapState === 'READY_EMPTY'
      ? 'READY'
      : 'ATTACHED'
  }

  measureCurrentWindow(): HeightDelta[] {
    const snapshot = this.deps.store.getSnapshot()
    const container = this.deps.registry.getContainer()

    if (!container) {
      return []
    }

    const deltas = this.deps.measurement.measureMountedRows(
      snapshot.items,
      snapshot.revision,
      container.clientWidth,
    )

    if (deltas.length > 0) {
      this.deps.spacer.invalidateEstimateCache()
      this.deps.emitDiagnostic({
        channel: 'measurement',
        severity: 'debug',
        name: 'measurement.mountedRows',
        correlationId:
          `data:${snapshot.feedId}:${snapshot.generation}:${snapshot.revision}`,
        details: () => ({
          revision: snapshot.revision,
          deltaCount: deltas.length,
          totalDelta: deltas.reduce((total, delta) => total + delta.delta, 0),
          sample: deltas.slice(0, 5).map((delta) => ({
            key: delta.serializedKey,
            previousHeight: delta.previousHeight,
            nextHeight: delta.nextHeight,
            delta: delta.delta,
          })),
        }),
      })
    }

    return deltas
  }

  async waitForBootstrapSettle(
    feedId: string,
    generation: number,
  ): Promise<void> {
    const container = this.deps.registry.getContainer()

    if (!container) {
      return
    }

    const startedAt = this.deps.scheduler.now()
    let stableFrames = 0
    let previousScrollHeight = container.scrollHeight

    while (
      stableFrames < BOOTSTRAP_STABLE_FRAMES &&
      this.deps.scheduler.now() - startedAt < BOOTSTRAP_SETTLE_TIMEOUT_MS
    ) {
      await this.nextFrame(feedId, generation)

      const nextScrollHeight = container.scrollHeight
      const changed =
        Math.abs(nextScrollHeight - previousScrollHeight) >
        BOOTSTRAP_HEIGHT_EPSILON_PX

      stableFrames = changed ? 0 : stableFrames + 1
      previousScrollHeight = nextScrollHeight

      if (this.deps.scrollIntent.getBottomLockState() === 'LOCKED') {
        this.deps.motion.scrollToBottom('followBottom')
      }
    }
  }

  nextFrame(feedId: string, generation: number): Promise<void> {
    return new Promise((resolve) => {
      this.deps.scheduler.requestAnimationFrame(() => {
        this.deps.setCurrentFrame(this.deps.getCurrentFrame() + 1)

        if (this.deps.lifecycle.isCurrent(feedId, generation)) {
          resolve()
          return
        }

        resolve()
      })
    })
  }
}
