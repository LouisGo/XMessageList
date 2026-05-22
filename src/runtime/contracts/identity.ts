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
 * 这些 modifier 是已命名的保留设计槽位。runtime 没有专用 transaction 前，
 * 不能把它们静默降级成普通 refresh。
 */
export type ReservedViewportModifier =
  | 'remove-from-start'
  | 'item-location'
  | 'identity-remap'
  | 'anchor-risk'

/**
 * @deprecated 请使用 ViewportModifier / viewportModifier。
 * 这里仅作为迁移期输入兼容别名保留。
 */
export type ViewportEffect = ViewportModifier | ReservedViewportModifier
