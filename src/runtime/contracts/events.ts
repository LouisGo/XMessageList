import type { AnchorState, MessageIdentityAnchor } from './identity'

export type ViewportAnchorChangeReason =
  | 'scroll-idle'
  | 'transaction-settle'
  | 'detach'

export type ViewportAnchorChangedEvent = {
  type: 'viewportAnchorChanged'
  feedId: string
  generation: number
  reason: ViewportAnchorChangeReason
  anchor: AnchorState | null
}

export type DiagnosticChannel =
  | 'lifecycle'
  | 'data'
  | 'transaction'
  | 'projection'
  | 'scroll'
  | 'measurement'
  | 'motion'
  | 'recovery'
  | 'anchor'
  | 'edge'

export type DiagnosticSeverity = 'debug' | 'info' | 'warn' | 'error'

export type RuntimeDiagnosticsOptions =
  | boolean
  | {
      enabled?: boolean
      channels?: 'all' | DiagnosticChannel[]
      minSeverity?: DiagnosticSeverity
      maxEntries?: number
      emitEvents?: boolean
      sampleRate?: number
    }

export type ViewportDiagnosticRecord = {
  feedId: string
  generation: number
  channel: DiagnosticChannel
  severity: DiagnosticSeverity
  name: string
  correlationId?: string
  timestamp: number
  details: Record<string, unknown>
}

export type ViewportDiagnosticEvent = ViewportDiagnosticRecord & {
  type: 'viewportDiagnostic'
}

export type MessageViewportRuntimeEvent =
  | {
      type: 'needMoreBefore'
      feedId: string
      generation: number
      reason: 'near-top' | 'prepend-recovery'
    }
  | {
      type: 'needMoreAfter'
      feedId: string
      generation: number
      reason: 'near-bottom'
    }
  | {
      type: 'needLatestMessages'
      feedId: string
      generation: number
      reason: 'bottom-follow'
    }
  | {
      type: 'needMessagesAround'
      feedId: string
      generation: number
      reason: 'jump' | 'restore' | 'viewport-compaction'
      target: MessageIdentityAnchor
    }
  | {
      type: 'destinationSettled'
      feedId: string
      generation: number
      intent: 'jump'
      target: MessageIdentityAnchor
      resolution: 'target' | 'fallback-deleted'
      resolvedTarget?: MessageIdentityAnchor
    }
  | ViewportAnchorChangedEvent
  | ViewportDiagnosticEvent
  | { type: 'viewportReady'; feedId: string; generation: number }
  | { type: 'viewportError'; feedId: string; generation: number; code: string }

export type RuntimeEventListener = (
  event: MessageViewportRuntimeEvent,
) => void
