import type { AnchorState, MessageIdentityAnchor } from '../identity/types'
import type { RuntimeNextDiagnosticRecord } from '../diagnostics/types'

export type ViewportAnchorChangeReason =
  | 'scroll-idle'
  | 'transaction-settle'
  | 'detach'

export type ViewportAnchorChangedEvent = {
  readonly type: 'viewportAnchorChanged'
  readonly feedId: string
  readonly generation: number
  readonly reason: ViewportAnchorChangeReason
  readonly anchor: AnchorState | null
}

export type RuntimeNextViewportEvent =
  | {
      readonly type: 'needMoreBefore'
      readonly feedId: string
      readonly generation: number
      readonly reason: 'near-top' | 'prepend-recovery'
    }
  | {
      readonly type: 'needMoreAfter'
      readonly feedId: string
      readonly generation: number
      readonly reason: 'near-bottom'
    }
  | {
      readonly type: 'needLatestMessages'
      readonly feedId: string
      readonly generation: number
      readonly reason: 'bottom-follow'
    }
  | {
      readonly type: 'needMessagesAround'
      readonly feedId: string
      readonly generation: number
      readonly reason: 'jump' | 'restore'
      readonly target: MessageIdentityAnchor
    }
  | {
      readonly type: 'destinationSettled'
      readonly feedId: string
      readonly generation: number
      readonly intent: 'jump'
      readonly target: MessageIdentityAnchor
      readonly resolution: 'target' | 'fallback-deleted'
      readonly resolvedTarget?: MessageIdentityAnchor
    }
  | ViewportAnchorChangedEvent
  | (RuntimeNextDiagnosticRecord & { readonly type: 'viewportDiagnostic' })
  | {
      readonly type: 'viewportReady'
      readonly feedId: string
      readonly generation: number
    }
  | {
      readonly type: 'viewportError'
      readonly feedId: string
      readonly generation: number
      readonly code: string
    }

export type RuntimeNextEventListener = (
  event: RuntimeNextViewportEvent,
) => void

export type RuntimeEventListener = RuntimeNextEventListener
