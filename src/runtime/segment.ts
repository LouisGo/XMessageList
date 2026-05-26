import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from './identity'

export type SegmentModifier =
  | { type: 'bootstrap' }
  | { type: 'extend-before'; requestToken: string }
  | { type: 'extend-after'; requestToken: string }
  | { type: 'reset-around'; target: MessageIdentityAnchor }
  | { type: 'reset-latest' }
  | { type: 'trim-before'; trimToken: string }
  | { type: 'trim-after'; trimToken: string }
  | { type: 'patch'; changedKeys: MessageRuntimeItemKey[] }
  | {
      type: 'identity-remap'
      remaps: Array<{
        from: MessageIdentityAnchor
        to: MessageIdentityAnchor
        previousKey?: MessageRuntimeItemKey
        nextKey: MessageRuntimeItemKey
      }>
    }

export type LoadedSegment<TMessage = unknown, TOptimistic = unknown> = {
  feedId: string
  generation: number
  segmentRevision: number
  items: MessageDataItem<TMessage, TOptimistic>[]
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  anchor?: MessageIdentityAnchor
  anchorStatus?: 'normal' | 'deleted' | 'unavailable' | 'permission'
  modifier: SegmentModifier
}
