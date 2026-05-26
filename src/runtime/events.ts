import type { MessageIdentityAnchor } from './identity'
import type { ProjectionCommitToken } from './snapshot'

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
  reason: 'scroll-idle' | 'transaction-settle' | 'detach'
  anchor: MessageIdentityAnchor | null
}

export type ViewportObservationChangedEvent = {
  type: 'viewportObservationChanged'
  feedId: string
  visibleKeys: string[]
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
