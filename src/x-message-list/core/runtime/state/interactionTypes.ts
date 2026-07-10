import type { MessageIdentityAnchor } from '../contracts/identity'
import type { MessageListRuntimeEvent } from '../contracts/events'
import type { DOMRectLike, MessageListSnapshot } from '../contracts/snapshot'
import type { ScrollSource } from '../scroll/scrollIntentEngine'
import type { MessageListScrollMotionHint } from '../contracts/options'

export type RuntimeEdge = 'before' | 'after'

export type DestinationIntent = {
  target: MessageIdentityAnchor
  reason: 'jump' | 'restore'
  align: 'start' | 'center' | 'end' | 'nearest'
  offsetWithinMessage?: number
  motion?: MessageListScrollMotionHint
  requestToken?: string
}

export type InteractionUpdate<TMessage, TOptimistic> = {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  event?: MessageListRuntimeEvent
}

export type UnderflowInput<TMessage, TOptimistic> = {
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  scrollHeight: number
  clientHeight: number
  viewportTop: number
  viewportBottom: number
  beforeTrigger: DOMRectLike
  afterTrigger: DOMRectLike
}

export type EdgeNeedOptions = {
  source?: ScrollSource | null
  ignoreScrollSource?: boolean
}
