import type { MessageIdentityAnchor } from './identity'
import type { ProjectionCommitToken } from './snapshot'

export type DestinationCancelledEvent = {
  type: 'destinationCancelled'
  sessionId: string
  generation: number
  segmentRevision: number
  requestToken: string
  reason: 'user-interrupt'
}

export type ViewportNavigationIntentEvent = {
  type: 'viewportNavigationIntent'
  sessionId: string
  generation: number
  segmentRevision: number
  reason: 'user-scroll'
}

export type DestinationSettledEvent = {
  type: 'destinationSettled'
  sessionId: string
  generation: number
  segmentRevision: number
  intent: 'jump' | 'restore'
  target: MessageIdentityAnchor
  resolution: 'target' | 'fallback'
  resolvedTarget?: MessageIdentityAnchor
}

export type ProjectionSettledEvent = {
  type: 'projectionSettled'
  sessionId: string
  generation: number
  segmentRevision: number
  commitToken: ProjectionCommitToken
  status: 'applied' | 'commit-timeout' | 'motion-cancelled'
}
