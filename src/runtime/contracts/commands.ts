import type { AnchorState, MessageIdentityAnchor } from './identity'

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
  | 'viewportCompaction'
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
