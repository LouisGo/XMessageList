import type {
  AnchorState,
  BootstrapState,
  MessageDataItem,
  MessageDataSnapshot,
  MessageIdentityAnchor,
  MessageRuntimeCommand,
  MessageRuntimeItemKey,
  MessageViewportRuntimeOptions,
  MessageViewportSnapshot,
  RenderWindow,
  RuntimeState,
  ScrollMotionOptions,
  ViewportPhase,
  TransactionState,
  DestinationState,
} from '../../types'
import type { RuntimeDiagnosticInput } from '../../debug/diagnosticRecorder'
import type { ScrollMotionSource } from '../../scroll/scrollMotionEngine'

export type DestinationMotionForcedStart = 'beforeTarget' | 'afterTarget'

export type PublishResult<TMessage, TOptimistic> = {
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
  changed: boolean
}

export type ContainerSize = {
  width: number
  height: number
}

export type ScrollFrameMetrics = {
  scrollTop: number
  clientHeight: number
  clientWidth: number
  scrollHeight: number
  distanceToBottom: number
}

export type MeasurableRow = {
  key: MessageRuntimeItemKey
  element: HTMLElement
}

/**
 * ReadySubstate 只描述 READY 生命周期下的用户目的地意图。
 * 它不负责 DOM commit 串行化；transaction 轴独立表达 projection mutation。
 */
export type ReadySubstate =
  | 'READY_IDLE'
  | 'READY_FOLLOW_BOTTOM_PENDING'
  | 'READY_DESTINATION_PENDING'
  | 'READY_VIEWPORT_COMPACTION_PENDING'
  | 'READY_MOTION_ACTIVE'

export type PendingFollowBottom = {
  feedId: string
  generation: number
  commandId: string
  emittedAfterRevision: number | null
  lastScrollTop: number
}

export type ActiveFollowBottomIntent = {
  feedId: string
  generation: number
  commandId: string
  lastScrollTop: number
}

export type PendingDestinationRequest = {
  feedId: string
  generation: number
  commandId: string
  intent: 'jump' | 'restore'
  target: MessageIdentityAnchor
  commandTarget: AnchorState | MessageIdentityAnchor
  emittedAfterRevision: number | null
  forceAnimateFrom?: DestinationMotionForcedStart
  animateOnResolve: boolean
}

export type PendingViewportCompaction = {
  feedId: string
  generation: number
  commandId: string
  triggerRevision: number
  triggerModifier: 'prepend' | 'append'
  target: MessageIdentityAnchor
  commandTarget: AnchorState
  emittedAfterRevision: number | null
}

export type DestinationMotionSettle<TMessage, TOptimistic> = {
  source: ScrollMotionSource
  targetTop: number
  bottomLockState: MessageViewportSnapshot['bottomLockState']
  data: MessageDataSnapshot<TMessage, TOptimistic>
  renderWindow: RenderWindow
  destination?: {
    intent: 'jump'
    target: MessageIdentityAnchor
    resolution: 'target' | 'fallback-deleted'
    resolvedTarget?: MessageIdentityAnchor
  }
}

export type RuntimeDiagnosticEmitter = (input: RuntimeDiagnosticInput) => void

export type PublishProjectionInput<TMessage, TOptimistic> = {
  data: MessageDataSnapshot<TMessage, TOptimistic>
  renderWindow: RenderWindow
  bootstrapState: BootstrapState
  bottomLockState: MessageViewportSnapshot['bottomLockState']
  viewportPhase?: ViewportPhase
  topSpacer?: number
  bottomSpacer?: number
}

/**
 * TransactionState 和 DestinationState 进入 diagnostics / debug snapshot，
 * 但不扩张 public snapshot；它们是 controller 内部的一等状态轴。
 */
export type RuntimeStateAxes = {
  transactionState: TransactionState
  destinationState: DestinationState
}

export type CommitRecoveryInput<TMessage, TOptimistic> = {
  token: { feedId: string; generation: number }
  nextState: RuntimeState
  restoreBottomLockState?: MessageViewportSnapshot['bottomLockState']
  restoreProjection?: PublishProjectionInput<TMessage, TOptimistic>
  restoreSnapshot?: MessageViewportSnapshot<TMessage, TOptimistic>
}

export type RestoreTarget = {
  key: MessageRuntimeItemKey
  offsetWithinMessage: number
  index: number
}

export type BootstrapCommand = Extract<
  MessageRuntimeCommand,
  { type: 'bootstrap' }
>

export type RuntimeCommitTimeoutMs = Required<
  NonNullable<MessageViewportRuntimeOptions['commitTimeoutMs']>
>

export const BOOTSTRAP_STABLE_FRAMES = 2
export const BOOTSTRAP_HEIGHT_EPSILON_PX = 1
export const BOOTSTRAP_SETTLE_TIMEOUT_MS = 300
export const DEFAULT_EDGE_LOAD_THRESHOLD_PX = 96
export const DEFAULT_VIEWPORT_COMPACTION_SPACER_THRESHOLD_PX = 6000
export const VIEWPORT_ANCHOR_IDLE_MS = 180
export const USER_SCROLL_DIRECTION_EPSILON_PX = 0.5

export const DEFAULT_SCROLL_MOTION_OPTIONS: Required<ScrollMotionOptions> = {
  enabled: true,
  respectReducedMotion: true,
  maxDistancePx: 800,
  minDurationMs: 180,
  maxDurationMs: 420,
  targetEpsilonPx: 1,
}

export function isAnchorState(
  value: AnchorState | { messageId: string; position?: number } | undefined,
): value is AnchorState {
  return Boolean(value && 'key' in value)
}

export function cloneAnchorState(anchor: AnchorState): AnchorState {
  return {
    key: { ...anchor.key },
    offsetWithinMessage: anchor.offsetWithinMessage,
  }
}

export function keepRangeWithinItems<TMessage, TOptimistic>(
  items: Array<MessageDataItem<TMessage, TOptimistic>>,
  startIndex: number,
  endIndex: number,
): { startIndex: number; endIndex: number } {
  if (items.length === 0) {
    return { startIndex: 0, endIndex: -1 }
  }

  return {
    startIndex: Math.max(0, Math.min(startIndex, items.length - 1)),
    endIndex: Math.max(0, Math.min(endIndex, items.length - 1)),
  }
}
