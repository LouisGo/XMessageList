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
 * 数据 revision 对 viewport transaction 的显式提示。它借鉴 scroll modifier
 * 的显式建模，但只进入 runtime transaction，不作为 React prop 暴露。
 */
export type ViewportModifier =
  | 'none'
  | 'prepend'
  | 'append'
  | 'items-change'
  | 'auto-scroll-to-bottom'
  | 'reset'

/**
 * Reserved modifiers are documented design slots, but they must not silently
 * degrade into refresh behavior until the runtime has dedicated transactions.
 */
export type ReservedViewportModifier =
  | 'remove-from-start'
  | 'item-location'
  | 'identity-remap'
  | 'anchor-risk'

/**
 * @deprecated Use ViewportModifier / viewportModifier. Kept as an input
 * compatibility alias while older call sites migrate.
 */
export type ViewportEffect = ViewportModifier | ReservedViewportModifier

export type MessageDataSnapshotChange = {
  kind:
    | 'initial'
    | 'prepend'
    | 'append'
    | 'patch'
    | 'delete'
    | 'identityRebind'
    | 'reset'
  viewportModifier?: ViewportModifier | ReservedViewportModifier
  /**
   * @deprecated Use viewportModifier.
   */
  viewportEffect?: ViewportEffect
}

export type MessageDataSnapshot<TMessage = unknown, TOptimistic = unknown> = {
  feedId: string
  generation: number
  revision: number
  // 当前已加载 DataWindow，不保证覆盖整个 feed；hasMoreBefore/After 才是数据边界真相。
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
  overscan?: number
  maxMountedItems?: number
}

export type NormalizedWindowConfig = {
  overscan: number
  maxMountedItems: number
}

/**
 * BottomLockState 只表达业务吸底语义：当前 viewport 是否锁在 feed latest。
 * 它不表达 projection、measurement、correction 或 animation 的中间过程；
 * 这些视觉阶段必须放到 ViewportPhase，避免 UI 用吸底状态推断 runtime 事务。
 */
export type BottomLockState = 'LOCKED' | 'UNLOCKED'

/**
 * BootstrapState 是 bootstrap 子状态机的 public projection。
 * MOUNTING/MEASURING/STABILIZING 分别对应挂载、测量、稳定校正阶段；
 * 这些阶段只约束首屏启动，不代表普通 READY 事务。
 */
export type BootstrapState =
  | 'INITIAL'
  | 'MOUNTING'
  | 'MEASURING'
  | 'STABILIZING'
  | 'READY'
  | 'READY_EMPTY'

/**
 * ViewportPhase 表达 runtime 正在经历的视觉中间态。
 * 它是 bottom lock 的正交轴：LOCKED + PROJECTING、UNLOCKED + MOTION_ACTIVE
 * 都是合法组合，React adapter 不应再用 bottomLockState 承担 recovery 语义。
 */
export type ViewportPhase =
  | 'IDLE'
  | 'PROJECTING'
  | 'MEASURING'
  | 'CORRECTING'
  | 'MOTION_ACTIVE'

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
  viewportPhase: ViewportPhase
  edgeState: ViewportEdgeState
}

export type ProjectionCommit = {
  feedId: string
  generation: number
  // React 在该 revision 的 DOM/ref 已落地后回传；runtime 事务只能等这个 ack 再读 DOM。
  revision: number
}

export type MessageRuntimeCommand =
  | {
      type: 'bootstrap'
      mode: 'latest' | 'unread' | 'restored'
      target?: AnchorState | MessageIdentityAnchor
    }
  | { type: 'jump'; target: MessageIdentityAnchor; origin?: MessageIdentityAnchor }
  | { type: 'restore'; target: AnchorState | MessageIdentityAnchor }
  | { type: 'followBottom' }
  | { type: 'reset'; reason: string }

// direct-scroll 只允许表达 runtime 已知的自定义滚动条输入来源。
// 新 source 需要先明确是否等价于用户滚动，以及是否要取消当前 motion。
export type DirectScrollSource =
  | 'custom-scrollbar-drag'
  | 'custom-scrollbar-track'

export type DirectScrollInput = {
  source: DirectScrollSource
}

export type RuntimeListener = () => void

/**
 * RuntimeState 只表达 runtime 容器生命周期。
 * Transaction、destination motion、bottom lock 都是正交状态轴，不能再提升为
 * lifecycle 值；尤其不能用 lifecycle 判断 jump/followBottom 是否完成。
 */
export type RuntimeState =
  | 'INITIAL'
  | 'ATTACHED'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'DETACHED'
  | 'DESTROYED'

/**
 * TransactionState 只表达 projection/DOM commit/measurement/correction 的串行化。
 * active transaction 不代表用户目的地已经完成，也不改变 RuntimeState。
 */
export type TransactionState = 'idle' | 'queued' | 'active' | 'settling'

/**
 * DestinationState 承载 jump/restore/followBottom 的用户意图生命周期。
 * transaction-supersede 只能让坐标失效；只有 user-interrupt 才终止该意图。
 */
export type DestinationState =
  | 'idle'
  | 'pendingData'
  | 'resolvingDom'
  | 'motionActive'
  | 'interrupted'
  | 'settled'

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

export type ViewportAnchorChangeReason =
  | 'scroll-idle'
  | 'transaction-settle'
  | 'detach'

export type ViewportAnchorChangedEvent = {
  type: 'viewportAnchorChanged'
  feedId: string
  generation: number
  reason: ViewportAnchorChangeReason
  anchor: AnchorState | null
}

export type DiagnosticChannel =
  | 'lifecycle'
  | 'data'
  | 'transaction'
  | 'projection'
  | 'scroll'
  | 'measurement'
  | 'motion'
  | 'recovery'
  | 'anchor'
  | 'edge'

export type DiagnosticSeverity = 'debug' | 'info' | 'warn' | 'error'

export type RuntimeDiagnosticsOptions =
  | boolean
  | {
      enabled?: boolean
      channels?: 'all' | DiagnosticChannel[]
      minSeverity?: DiagnosticSeverity
      maxEntries?: number
      emitEvents?: boolean
      sampleRate?: number
    }

export type ViewportDiagnosticRecord = {
  feedId: string
  generation: number
  channel: DiagnosticChannel
  severity: DiagnosticSeverity
  name: string
  correlationId?: string
  timestamp: number
  details: Record<string, unknown>
}

export type ViewportDiagnosticEvent = ViewportDiagnosticRecord & {
  type: 'viewportDiagnostic'
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
      reason: 'near-bottom'
    }
  | {
      type: 'needLatestMessages'
      feedId: string
      generation: number
      reason: 'bottom-follow'
    }
  | {
      type: 'needMessagesAround'
      feedId: string
      generation: number
      reason: 'jump' | 'restore'
      target: MessageIdentityAnchor
    }
  | {
      type: 'destinationSettled'
      feedId: string
      generation: number
      intent: 'jump'
      target: MessageIdentityAnchor
      resolution: 'target' | 'fallback-deleted'
      resolvedTarget?: MessageIdentityAnchor
    }
  | ViewportAnchorChangedEvent
  | ViewportDiagnosticEvent
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
  window?: WindowConfig
  scrollMotion?: Partial<ScrollMotionOptions>
  debug?: {
    diagnostics?: RuntimeDiagnosticsOptions
  }
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
