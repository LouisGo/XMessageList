import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
  ReservedViewportModifier,
  ViewportEffect,
  ViewportModifier,
} from './identity'

export type MessageIdentityRemap = {
  from: Extract<MessageRuntimeItemKey, { kind: 'optimistic' }>
  to: Extract<MessageRuntimeItemKey, { kind: 'committed' }>
}

export type NonEmptyMessageIdentityRemaps = [
  MessageIdentityRemap,
  ...MessageIdentityRemap[],
]

type MessageDataSnapshotChangeKind =
  | 'initial'
  | 'prepend'
  | 'append'
  | 'patch'
  | 'delete'
  | 'identityRebind'
  | 'reset'

type MessageDataSnapshotChangeBase = {
  kind: MessageDataSnapshotChangeKind
  /**
   * @deprecated 请使用 viewportModifier。
   */
  viewportEffect?: ViewportEffect
}

type IdentityRemapSnapshotChange = MessageDataSnapshotChangeBase & {
  kind: 'identityRebind'
  viewportModifier: 'identity-remap'
  // identity-remap 必须显式携带 key 映射；runtime 不按 index 或内容猜测身份绑定。
  identityRemaps: NonEmptyMessageIdentityRemaps
}

type LegacyIdentityRemapSnapshotChange = Omit<
  MessageDataSnapshotChangeBase,
  'viewportEffect'
> & {
  kind: 'identityRebind'
  viewportModifier?: undefined
  /**
   * @deprecated 请使用 viewportModifier。
   */
  viewportEffect: 'identity-remap'
  // 兼容迁移期旧字段，但同样要求显式、非空映射。
  identityRemaps: NonEmptyMessageIdentityRemaps
}

type NonIdentityRemapSnapshotChange = MessageDataSnapshotChangeBase & {
  kind:
    | Exclude<MessageDataSnapshotChangeKind, 'identityRebind'>
    | 'identityRebind'
  viewportModifier?: Exclude<
    ViewportModifier | ReservedViewportModifier,
    'identity-remap'
  >
  /**
   * @deprecated 请使用 viewportModifier。
   */
  viewportEffect?: Exclude<ViewportEffect, 'identity-remap'>
  identityRemaps?: never
}

export type MessageDataSnapshotChange =
  | IdentityRemapSnapshotChange
  | LegacyIdentityRemapSnapshotChange
  | NonIdentityRemapSnapshotChange

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
