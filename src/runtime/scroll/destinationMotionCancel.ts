import type { ProjectionCoordinator } from '../core/projection/projectionCoordinator'
import type { ProjectionStore } from '../core/state/projectionStore'
import type {
  DestinationMotionSettle,
  RuntimeDiagnosticEmitter,
} from '../core/state/runtimeTypes'
import type { DestinationState, ViewportTransactionKind } from '../types'
import type { ScrollIntentEngine } from './scrollIntentEngine'
import type { ScrollMotionCancelReason } from './scrollMotionEngine'

export type DestinationMotionCancelContext = {
  transactionKind?: ViewportTransactionKind
  transactionId?: string
}

export function applyDestinationMotionCancel<TMessage, TOptimistic>(input: {
  reason: ScrollMotionCancelReason
  settle: DestinationMotionSettle<TMessage, TOptimistic> | null
  container: HTMLElement | null
  context: DestinationMotionCancelContext | null
  isDestroyed: () => boolean
  store: ProjectionStore<TMessage, TOptimistic>
  scrollIntent: ScrollIntentEngine
  projection: ProjectionCoordinator<TMessage, TOptimistic>
  setDestinationState: (state: DestinationState) => void
  clearDestinationMotionSettle: () => void
  onDestinationMotionSupersede: (
    settle: DestinationMotionSettle<TMessage, TOptimistic>,
    context: DestinationMotionCancelContext | null,
  ) => void
  emitDiagnostic: RuntimeDiagnosticEmitter
}): void {
  const { reason, settle, container, context } = input

  input.emitDiagnostic({
    channel: 'motion',
    severity: reason === 'user-interrupt' ? 'info' : 'debug',
    name: 'destinationMotion.cancel',
    correlationId: settle
      ? `motion:${settle.source}:${settle.data.feedId}:${settle.data.generation}:${settle.data.revision}`
      : undefined,
    details: () => ({
      source: settle?.source ?? null,
      reason,
      targetTop: settle?.targetTop ?? null,
      scrollTop: container?.scrollTop ?? null,
      distancePx: settle && container ? settle.targetTop - container.scrollTop : null,
      transactionKind: context?.transactionKind ?? null,
      transactionId: context?.transactionId ?? null,
    }),
  })

  input.clearDestinationMotionSettle()

  if (!settle || input.isDestroyed()) {
    return
  }

  if (
    reason === 'transaction-supersede' &&
    settle.source === 'jump' &&
    settle.destination
  ) {
    // data/resize 事务会让已测量坐标失效，但不能吞掉用户 jump 意图；
    // 等覆盖事务 commit 后重新解析，避免对半途 motion 发 destinationSettled。
    input.onDestinationMotionSupersede(settle, context)
    return
  }

  if (reason !== 'user-interrupt' && reason !== 'resize-during-motion') {
    return
  }

  const bottomLockState =
    reason === 'resize-during-motion' ? settle.bottomLockState : 'UNLOCKED'

  // 用户打断表示放弃目的地；resize 打断只是坐标失效，仍保留原事务期望的 lock 语义。
  input.setDestinationState(
    reason === 'user-interrupt' ? 'interrupted' : 'settled',
  )
  input.scrollIntent.setBottomLockState(bottomLockState)
  input.projection.publish({
    data: settle.data,
    renderWindow: settle.renderWindow,
    bootstrapState: input.store.getSnapshot().bootstrapState,
    bottomLockState,
    viewportPhase: 'IDLE',
  })
}
