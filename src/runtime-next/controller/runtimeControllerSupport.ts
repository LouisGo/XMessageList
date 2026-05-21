import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeNextDiagnosticRecord } from '../diagnostics/types'
import type { RuntimeEventListener } from '../events/types'
import type {
  ActiveDataProjection,
  PendingDataIntent,
} from '../data/classifier.types'
import type { RenderWindow } from '../projection/types'
import type { PhysicalSegment } from '../geometry/segment/physicalSegment.types'
import type {
  RuntimeTransaction,
  TransactionAbortReason,
} from '../transactions/types'
import {
  createNeedLatestEvent,
  createNeedMessagesAroundEvent,
  targetToIdentityAnchor,
} from './controllerHelpers'

export function recordTransactionStage(
  diagnostics: DiagnosticRecorder,
  record: {
    readonly transaction: {
      readonly id: string
      readonly kind: string
      readonly stage: string
    }
    readonly previousStage: string | null
  },
): void {
  diagnostics.record({
    kind: record.transaction.stage === 'aborted'
      ? 'transaction-error'
      : 'transaction-lifecycle',
    severity: record.transaction.stage === 'aborted' ? 'warn' : 'info',
    owner: 'transactions',
    message: `transaction ${record.transaction.kind} -> ${record.transaction.stage}`,
    details: {
      transactionId: record.transaction.id,
      stage: record.transaction.stage,
      previousStage: record.previousStage,
    },
  })
}

export function recordDataIntent(
  diagnostics: DiagnosticRecorder,
  intent: { readonly kind: string },
): void {
  diagnostics.record({
    kind: 'data-classifier-intent',
    owner: 'data',
    message: `data classifier produced ${intent.kind}`,
    details: { intent },
  })
}

export function recordWriterIssue(
  diagnostics: DiagnosticRecorder,
  kind: RuntimeNextDiagnosticRecord['kind'],
  message: string,
): void {
  diagnostics.record({ kind, severity: 'warn', owner: 'scroll', message })
}

export function shouldRetainPendingDataIntent(
  pending: PendingDataIntent | null,
  intent: { readonly kind: string; readonly reason?: string },
): boolean {
  if (pending === null || intent.kind !== 'no-op') {
    return false
  }

  return intent.reason === 'latest-data-still-missing' ||
    intent.reason === 'pending-jump-target-missing' ||
    intent.reason === 'pending-restore-target-missing' ||
    intent.reason === 'pending-shift-missing-data'
}

export function emitNeedForPendingIntent(
  feedId: string,
  generation: number,
  emitEvent: (event: Parameters<RuntimeEventListener>[0]) => void,
  intent: PendingDataIntent,
): void {
  switch (intent.kind) {
    case 'followBottom':
      emitEvent(createNeedLatestEvent({ feedId, generation }))
      return
    case 'jump':
    case 'restore':
      emitEvent(createNeedMessagesAroundEvent({
        feedId,
        generation,
        reason: intent.kind,
        target: targetToIdentityAnchor(intent.target),
      }))
      return
    case 'segmentShift':
      if (intent.direction === 'before') {
        emitEvent({
          type: 'needMoreBefore',
          feedId,
          generation,
          reason: 'near-top',
        })
        return
      }

      emitEvent({
        type: 'needMoreAfter',
        feedId,
        generation,
        reason: 'near-bottom',
      })
      return
  }
}

export function retainWriterDeniedIntent<TMessage, TOptimistic>(
  transaction: RuntimeTransaction<TMessage, TOptimistic>,
  reason: TransactionAbortReason,
): PendingDataIntent | null {
  if (reason !== 'writer-denied') return null
  const intent = transaction.intent
  if (intent.kind === 'followBottom') {
    if (intent.origin === 'auto-scroll-hint') return null
    return {
      kind: 'followBottom',
      origin: 'user-command',
      priority: 'latest',
    }
  }
  if (intent.kind === 'jump') {
    return {
      kind: 'jump',
      target: intent.target,
      origin: 'user',
      priority: 'destination',
    }
  }
  if (intent.kind === 'restore') {
    return {
      kind: 'restore',
      target: intent.target,
      origin: intent.origin ?? 'lifecycle',
      priority: 'destination',
    }
  }
  if (intent.kind === 'segmentShift') {
    return {
      kind: 'segmentShift',
      direction: intent.direction,
      origin: intent.source === 'wheel'
        ? 'wheel'
        : intent.source === 'drag-handoff'
          ? 'drag'
          : 'data',
      priority: 'edge',
    }
  }
  return null
}

export function createActiveDataProjection(
  segment: PhysicalSegment | null,
  renderWindow: RenderWindow,
): ActiveDataProjection | null {
  if (segment === null) return null
  return {
    renderWindow,
    logicalStartItemKey: segment.logicalStartItemKey,
    logicalEndItemKey: segment.logicalEndItemKey,
  }
}
