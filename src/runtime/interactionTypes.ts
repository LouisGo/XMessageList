import type { MessageIdentityAnchor } from './identity'
import type { MessageListRuntimeEvent } from './events'
import type { DOMRectLike, MessageListSnapshot } from './snapshot'
import type { ScrollSource } from './scrollIntentEngine'

export type RuntimeEdge = 'before' | 'after'

export type DestinationIntent = {
  target: MessageIdentityAnchor
  reason: 'jump' | 'restore'
  align: 'start' | 'center' | 'end' | 'nearest'
  offsetWithinMessage?: number
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
