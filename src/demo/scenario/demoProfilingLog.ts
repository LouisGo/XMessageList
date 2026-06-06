import type { MessageListRuntimeLogEvent } from '../../index'
import {
  createDemoRequestId,
  writeDemoLog,
} from '../data/demoLocalStoreClient'

const IMPORTANT_DIAGNOSTIC_PREFIXES = [
  'measurement.transaction.',
  'transaction.',
  'destinationMotion.',
  'commit.',
  'edge.',
  'overlay.',
  'blank-area.',
  'frame-gap.',
  'measurement.resize.',
]

const TRANSACTION_RECT_READ_DIAGNOSTICS = new Set([
  'measurement.rectRead.count',
  'measurement.rectRead.rows',
])

const IMPORTANT_RUNTIME_EVENT_TYPES = new Set([
  'needMessagesAround',
  'needLatestMessages',
  'needMoreBefore',
  'needMoreAfter',
  'destinationSettled',
  'segmentTrimPressure',
  'viewportReady',
  'viewportError',
])

export function logDemoRuntimeEvent(
  event: MessageListRuntimeLogEvent,
  fallbackFeedId: string,
): void {
  const details = toRuntimeEventLogDetails(event)
  if (!details) {
    return
  }

  void writeDemoLog({
    requestId: createDemoRequestId('runtime.event'),
    operation: 'runtime.event',
    phase: event.type === 'viewportError' ? 'error' : 'info',
    feedId: event.sessionId ?? fallbackFeedId,
    details,
  })
}

function toRuntimeEventLogDetails(
  event: MessageListRuntimeLogEvent,
): Record<string, unknown> | null {
  if (event.type === 'viewportDiagnostic') {
    if (!event.diagnostic || !shouldLogDiagnostic(event.diagnostic)) {
      return null
    }

    return {
      eventType: event.type,
      diagnostic: sanitizeLogValue(event.diagnostic),
    }
  }

  if (!IMPORTANT_RUNTIME_EVENT_TYPES.has(event.type)) {
    return null
  }

  const sanitized = sanitizeLogValue(event)
  return {
    eventType: event.type,
    ...(isRecord(sanitized) ? sanitized : { value: sanitized }),
  }
}

function shouldLogDiagnostic(
  record: NonNullable<MessageListRuntimeLogEvent['diagnostic']>,
): boolean {
  if (TRANSACTION_RECT_READ_DIAGNOSTICS.has(record.name)) {
    const source = record.details.source
    return typeof source === 'string' && source.startsWith('transaction-')
  }

  return IMPORTANT_DIAGNOSTIC_PREFIXES.some((prefix) =>
    record.name.startsWith(prefix)
  )
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value === undefined) {
    return undefined
  }

  if (Array.isArray(value)) {
    const sample = value
      .slice(0, 64)
      .map((item) => sanitizeLogValue(item, depth + 1))

    if (value.length <= 64) {
      return sample
    }

    return {
      length: value.length,
      sample,
    }
  }

  if (!isRecord(value)) {
    return String(value)
  }

  if (depth >= 4) {
    return '[object]'
  }

  const record: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'function' || typeof child === 'symbol') {
      continue
    }
    record[key] = sanitizeLogValue(child, depth + 1)
  }
  return record
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
