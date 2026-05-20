import type {
  MessageDataItem,
} from '../projection/types'
import type { MessageIdentityAnchor } from '../identity/types'

export type ViewportModifier =
  | 'none'
  | 'prepend'
  | 'append'
  | 'items-change'
  | 'auto-scroll-to-bottom'
  | 'reset'

export type MessageDataSnapshotChange = {
  readonly kind:
    | 'initial'
    | 'prepend'
    | 'append'
    | 'patch'
    | 'delete'
    | 'identityRebind'
    | 'reset'
  readonly viewportModifier: ViewportModifier
}

export type RuntimeNextDataSnapshot<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  readonly feedId: string
  readonly generation: number
  readonly revision: number
  readonly items: readonly MessageDataItem<TMessage, TOptimistic>[]
  readonly anchor?: MessageIdentityAnchor
  readonly anchorStatus?: 'normal' | 'deleted'
  readonly hasMoreBefore: boolean
  readonly hasMoreAfter: boolean
  readonly change: MessageDataSnapshotChange
}

export type MessageDataSnapshot<
  TMessage = unknown,
  TOptimistic = unknown,
> = RuntimeNextDataSnapshot<TMessage, TOptimistic>
