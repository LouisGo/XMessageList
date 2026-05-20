export type RuntimeNextFeedId = string
export type RuntimeNextGeneration = number
export type RuntimeNextRevision = number
export type RuntimeNextSegmentId = string
export type RuntimeNextTransactionId = string

export type MessageIdentityAnchor = {
  readonly messageId: string
  readonly position?: number
}

export type MessageRuntimeItemKey =
  | {
      readonly kind: 'committed'
      readonly messageId: string
    }
  | {
      readonly kind: 'optimistic'
      readonly clientMessageId: string
    }

export type AnchorState = {
  readonly key: MessageRuntimeItemKey
  readonly offsetWithinMessage: number
}

export type RuntimeNextListener = () => void
export type RuntimeNextUnsubscribe = () => void

export type RuntimeListener = RuntimeNextListener
export type RuntimeUnsubscribe = RuntimeNextUnsubscribe
