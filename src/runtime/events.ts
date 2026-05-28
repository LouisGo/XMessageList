import type {
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from './identity'
import type { ProjectionCommitToken } from './snapshot'
import type { ScrollSource } from './scrollIntentEngine'

export type NeedEventBase = {
  feedId: string
  generation: number
  segmentRevision: number
  requestToken: string
  reason: string
}

export type NeedMoreBeforeEvent = NeedEventBase & {
  type: 'needMoreBefore'
  edge: 'before'
}

export type NeedMoreAfterEvent = NeedEventBase & {
  type: 'needMoreAfter'
  edge: 'after'
}

export type NeedLatestMessagesEvent = NeedEventBase & {
  type: 'needLatestMessages'
}

export type NeedMessagesAroundEvent = NeedEventBase & {
  type: 'needMessagesAround'
  target: MessageIdentityAnchor
}

export type ViewportAnchorChangedEvent = {
  type: 'viewportAnchorChanged'
  feedId: string
  generation: number
  segmentRevision: number
  reason: 'scroll-idle' | 'transaction-settle' | 'detach'
  anchor: MessageIdentityAnchor | null
  offsetWithinMessage?: number
}

export type ViewportObservationChangedEvent = {
  type: 'viewportObservationChanged'
  feedId: string
  generation: number
  segmentRevision: number
  reason: ViewportObservationReason
  scrollSource: ScrollSource | null
  direction: ViewportScrollDirection
  activity: ViewportObservationActivity
  anchor: MessageIdentityAnchor | null
  offsetWithinMessage?: number
  visibleRange: ViewportVisibleRange
  visibleItems: ViewportObservedItem[]
  visibleKeys: string[]
}

export type ViewportObservationReason =
  | 'transaction-settle'
  | 'scroll-idle'
  | 'resize'
  | 'detach'

export type ViewportScrollDirection = 'up' | 'down' | 'none'

export type ViewportObservationActivity =
  | 'scrolling'
  | 'settling'
  | 'resizing'
  | 'detached'

export type ViewportVisibleRange = {
  firstKey: MessageRuntimeItemKey | null
  lastKey: MessageRuntimeItemKey | null
}

export type ViewportObservedItem = {
  key: MessageRuntimeItemKey
  visibleRatio: number
}

export type DestinationSettledEvent = {
  type: 'destinationSettled'
  feedId: string
  generation: number
  segmentRevision: number
  intent: 'jump' | 'restore'
  target: MessageIdentityAnchor
  resolution: 'target' | 'fallback'
  resolvedTarget?: MessageIdentityAnchor
}

export type SegmentTrimPressureEvent = {
  type: 'segmentTrimPressure'
  feedId: string
  generation: number
  segmentRevision: number
  itemCount: number
  anchor: MessageIdentityAnchor | null
  preferredTrimSide: 'before' | 'after'
}

export type ViewportDiagnosticEvent = {
  type: 'viewportDiagnostic'
  record: ViewportDiagnosticRecord
}

export type ViewportReadyEvent = {
  type: 'viewportReady'
  feedId: string
  commitToken: ProjectionCommitToken
}

export type ViewportErrorEvent = {
  type: 'viewportError'
  feedId: string
  code: string
  message: string
}

export type MessageListRuntimeEvent =
  | NeedMoreBeforeEvent
  | NeedMoreAfterEvent
  | NeedLatestMessagesEvent
  | NeedMessagesAroundEvent
  | DestinationSettledEvent
  | SegmentTrimPressureEvent
  | ViewportAnchorChangedEvent
  | ViewportObservationChangedEvent
  | ViewportDiagnosticEvent
  | ViewportReadyEvent
  | ViewportErrorEvent

export type MessageListRuntimeEventListener = (
  event: MessageListRuntimeEvent,
) => void

export type ViewportObservationListener = (
  event: ViewportObservationChangedEvent,
) => void

export type ViewportDiagnosticRecord = {
  name: string
  severity: 'debug' | 'info' | 'warn' | 'error'
  timestamp: number
  details: Record<string, unknown>
}
