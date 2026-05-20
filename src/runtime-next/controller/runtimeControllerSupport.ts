import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeNextDiagnosticRecord } from '../diagnostics/types'
import type { RuntimeEventListener } from '../events/types'
import type { PendingDataIntent } from '../data/classifier.types'
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
