/**
 * 已提交消息的跨层身份锚点。它可以进入数据层 / Bridge 合同，
 * 但不能携带 DOM offset、scrollTop 或测量高度。
 */
export type MessageIdentityAnchor = {
  messageId: string
  position?: number
}

/**
 * viewport runtime 内部的视觉锚点。offset 依赖 DOM layout，
 * 所以它只能留在 renderer runtime 内部，不能作为跨进程合同。
 */
export type AnchorState = {
  key: MessageRuntimeItemKey
  offsetWithinMessage: number
}

/**
 * React projection 和 runtime registry 使用的稳定 item key。
 * optimistic key 允许参与临时投影，但不能成为持久导航 anchor。
 */
export type MessageRuntimeItemKey =
  | { kind: 'committed'; messageId: string }
  | { kind: 'optimistic'; clientMessageId: string }

export type CommittedMessageDataItem<TMessage = unknown> = {
  kind: 'committed'
  key: Extract<MessageRuntimeItemKey, { kind: 'committed' }>
  message: TMessage
  version: number
  contentVersion?: number
  estimatedHeight?: number
}

export type OptimisticMessageDataItem<TOptimistic = unknown> = {
  kind: 'optimistic'
  key: Extract<MessageRuntimeItemKey, { kind: 'optimistic' }>
  draft: TOptimistic
  status: 'sending' | 'failed'
  version: number
  contentVersion?: number
  estimatedHeight?: number
}

export type TombstoneMessageDataItem = {
  kind: 'tombstone'
  key: Extract<MessageRuntimeItemKey, { kind: 'committed' }>
  reason: 'deleted' | 'unavailable'
  version: number
  estimatedHeight?: number
}

export type MessageDataItem<TMessage = unknown, TOptimistic = unknown> =
  | CommittedMessageDataItem<TMessage>
  | OptimisticMessageDataItem<TOptimistic>
  | TombstoneMessageDataItem

/**
 * 数据变化对 viewport 的语义影响。它借鉴 scroll modifier 的显式建模，
 * 但只进入 runtime transaction，不作为 React prop 暴露。
 */
export type ViewportEffect =
  | 'none'
  | 'prepend'
  | 'append'
  | 'items-change'
  | 'remove-from-start'
  | 'auto-scroll-to-bottom'
  | 'item-location'
  | 'identity-remap'
  | 'anchor-risk'
  | 'reset'

export type MessageDataSnapshotChange = {
  kind:
    | 'initial'
    | 'prepend'
    | 'append'
    | 'patch'
    | 'delete'
    | 'identityRebind'
    | 'reset'
  viewportEffect: ViewportEffect
}

export type MessageDataSnapshot<TMessage = unknown, TOptimistic = unknown> = {
  feedId: string
  generation: number
  revision: number
  items: Array<MessageDataItem<TMessage, TOptimistic>>
  anchor?: MessageIdentityAnchor
  anchorStatus?: 'normal' | 'deleted'
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  change: MessageDataSnapshotChange
}

export type RenderWindow = {
  startIndex: number
  endIndex: number
  itemKeys: MessageRuntimeItemKey[]
}

export type WindowConfig = {
  minOverscanPx: number
  maxOverscanPx: number
  minMountedItems: number
  maxMountedItems: number
  trimMarginPx: number
  defaultItemHeight: number
}

export type BottomLockState = 'LOCKED' | 'UNLOCKED' | 'RECOVERING'

export type BootstrapState =
  | 'INITIAL'
  | 'MOUNTING'
  | 'MEASURING'
  | 'STABILIZING'
  | 'READY'
  | 'READY_EMPTY'

export type ViewportEdgeState = {
  before: 'idle' | 'loading' | 'exhausted' | 'error'
  after: 'idle' | 'loading' | 'exhausted' | 'error'
}

export type MessageViewportSnapshot<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  feedId: string
  generation: number
  revision: number
  items: Array<MessageDataItem<TMessage, TOptimistic>>
  renderWindow: RenderWindow
  topSpacer: number
  bottomSpacer: number
  bottomLockState: BottomLockState
  bootstrapState: BootstrapState
  edgeState: ViewportEdgeState
}

export type ProjectionCommit = {
  feedId: string
  generation: number
  revision: number
}

export type MessageRuntimeCommand =
  | {
      type: 'bootstrap'
      mode: 'latest' | 'unread' | 'restored'
      target?: AnchorState | MessageIdentityAnchor
    }
  | { type: 'jump'; target: MessageIdentityAnchor }
  | { type: 'restore'; target: AnchorState | MessageIdentityAnchor }
  | { type: 'followBottom' }
  | { type: 'reset'; reason: string }

export type RuntimeListener = () => void

export type RuntimeState =
  | 'INITIAL'
  | 'ATTACHED'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'TRANSACTING'
  | 'DETACHED'
  | 'DESTROYED'

export type ViewportTransactionKind =
  | 'bootstrap'
  | 'prepend'
  | 'append'
  | 'followBottom'
  | 'jump'
  | 'restore'
  | 'resize'
  | 'identityRebind'
  | 'reset'

export type ScrollSource =
  | 'user'
  | 'programmatic'
  | 'recovery'
  | 'followBottom'
  | 'jump'
  | 'momentum'

export type ScrollMotionOptions = {
  enabled?: boolean
  respectReducedMotion?: boolean
  maxDistancePx?: number
  minDurationMs?: number
  maxDurationMs?: number
  targetEpsilonPx?: number
}

export type MessageViewportRuntimeEvent =
  | {
      type: 'needMoreBefore'
      feedId: string
      generation: number
      reason: 'near-top' | 'prepend-recovery'
    }
  | {
      type: 'needMoreAfter'
      feedId: string
      generation: number
      reason: 'near-bottom' | 'bottom-follow'
    }
  | {
      type: 'viewportAnchorChanged'
      feedId: string
      generation: number
      reason: 'scroll-idle' | 'transaction-settle'
      anchor: AnchorState | null
    }
  | { type: 'viewportReady'; feedId: string; generation: number }
  | { type: 'viewportError'; feedId: string; generation: number; code: string }

export type RuntimeEventListener = (
  event: MessageViewportRuntimeEvent,
) => void

export type HeightRecord = {
  height: number
  measuredAtRevision: number
  contentVersion: number
  widthBucket: number
  lastAccessedAt: number
}

export type RuntimeScheduler = {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
  setTimeout(callback: () => void, timeoutMs: number): number
  clearTimeout(handle: number): void
  now(): number
}

export type RuntimeObserverFactory = {
  createResizeObserver(callback: ResizeObserverCallback): ResizeObserver | null
  createIntersectionObserver(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ): IntersectionObserver | null
}

export type MessageViewportRuntimeOptions = {
  feedId?: string
  generation?: number
  window?: Partial<WindowConfig>
  scrollMotion?: Partial<ScrollMotionOptions>
  scheduler?: RuntimeScheduler
  observers?: Partial<RuntimeObserverFactory>
  commitTimeoutMs?: Partial<{
    bootstrap: number
    normal: number
    jump: number
  }>
  bottomLockThresholdPx?: number
  bottomUnlockThresholdPx?: number
  edgeLoadThresholdPx?: number
}
