export type MessageIdentity = {
  feedId: string
  stableId: string
  serverId?: string
  localId?: string
  version: number
}

export type MessageIdentityAnchor = {
  feedId: string
  stableId: string
  serverId?: string
  localId?: string
  fallbackStableId?: string
  fallbackReason?: 'deleted' | 'unavailable' | 'permission'
}

export type MessageRuntimeItemKey = string

export type MessageDataItem<TMessage = unknown, TOptimistic = unknown> = {
  key: MessageRuntimeItemKey
  rowKind:
    | 'message'
    | 'date-separator'
    | 'system'
    | 'deleted-placeholder'
    | 'permission-fallback'
  identity?: MessageIdentity
  renderVersion: number
  message?: TMessage
  optimistic?: TOptimistic
}
