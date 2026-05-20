import type { AnchorState, MessageIdentityAnchor } from '../identity/types'

export type RuntimeNextCommandTarget = AnchorState | MessageIdentityAnchor

export type RuntimeNextCommand =
  | {
      readonly type: 'bootstrap'
      readonly mode: 'latest' | 'unread' | 'restored'
      readonly target?: RuntimeNextCommandTarget
    }
  | {
      readonly type: 'jump'
      readonly target: MessageIdentityAnchor
      readonly origin?: MessageIdentityAnchor
    }
  | {
      readonly type: 'restore'
      readonly target: RuntimeNextCommandTarget
    }
  | {
      readonly type: 'followBottom'
    }
  | {
      readonly type: 'reset'
      readonly reason: string
    }

export type MessageRuntimeCommand = RuntimeNextCommand

export type ViewportTransactionKind =
  | 'bootstrap'
  | 'segmentShift'
  | 'segmentRelayout'
  | 'projectionRefresh'
  | 'followBottom'
  | 'jump'
  | 'restore'
  | 'reset'
