// 旧 runtime 的 deprecated contract test：只保护现有诊断行为，不作为 runtime-next 设计门禁。
import { describe, expect, it } from 'vitest'
import { DiagnosticRecorder } from '../debug/diagnosticRecorder'
import type { ViewportDiagnosticEvent } from '../types'

function createRecorder(input?: {
  diagnostics?: ConstructorParameters<typeof DiagnosticRecorder>[0]
  events?: ViewportDiagnosticEvent[]
}) {
  let now = 0
  const events = input?.events ?? []
  const recorder = new DiagnosticRecorder(
    input?.diagnostics,
    () => {
      now += 1
      return now
    },
    () => ({
      feedId: 'feed',
      generation: 1,
      state: 'READY',
      readySubstate: 'READY_IDLE',
      viewportPhase: 'IDLE',
      transactionState: 'idle',
      destinationState: 'idle',
      pendingCommands: 0,
    }),
    (event) => {
      events.push(event)
    },
  )

  return { recorder, events }
}

describe('DiagnosticRecorder', () => {
  it('does not evaluate lazy details while disabled', () => {
    const { recorder, events } = createRecorder()
    let detailsEvaluated = 0

    recorder.emit({
      channel: 'motion',
      name: 'motion.test',
      details: () => {
        detailsEvaluated += 1
        return { value: 1 }
      },
    })

    expect(detailsEvaluated).toBe(0)
    expect(recorder.getRecords()).toEqual([])
    expect(events).toEqual([])
  })

  it('filters by channel and severity', () => {
    const { recorder } = createRecorder({
      diagnostics: {
        enabled: true,
        channels: ['motion'],
        minSeverity: 'warn',
      },
    })

    recorder.emit({
      channel: 'transaction',
      severity: 'error',
      name: 'transaction.error',
    })
    recorder.emit({
      channel: 'motion',
      severity: 'info',
      name: 'motion.info',
    })
    recorder.emit({
      channel: 'motion',
      severity: 'warn',
      name: 'motion.warn',
    })

    expect(recorder.getRecords()).toEqual([
      expect.objectContaining({
        channel: 'motion',
        severity: 'warn',
        name: 'motion.warn',
      }),
    ])
  })

  it('keeps a bounded ring buffer and can suppress event emission', () => {
    const { recorder, events } = createRecorder({
      diagnostics: {
        enabled: true,
        maxEntries: 2,
        emitEvents: false,
      },
    })

    recorder.emit({ channel: 'motion', name: 'one' })
    recorder.emit({ channel: 'motion', name: 'two' })
    recorder.emit({ channel: 'motion', name: 'three' })

    expect(recorder.getRecords().map((record) => record.name)).toEqual([
      'two',
      'three',
    ])
    expect(events).toEqual([])
  })

  it('captures transaction and destination axes in record details', () => {
    const { recorder } = createRecorder({
      diagnostics: {
        enabled: true,
      },
    })

    recorder.emit({
      channel: 'transaction',
      name: 'transaction.axes',
    })

    expect(recorder.getRecords()[0]?.details).toEqual(
      expect.objectContaining({
        transactionState: 'idle',
        destinationState: 'idle',
        viewportPhase: 'IDLE',
      }),
    )
  })
})
