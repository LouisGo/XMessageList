import type { ViewportDiagnosticRecord } from '../contracts/events'
import type { RuntimeScheduler } from '../contracts/options'

const DEFAULT_DIAGNOSTIC_LIMIT = 80

// 内存诊断只保留最近窗口；需要长期复现时由外层把 runtime event 落盘。
export class DiagnosticRingBuffer {
  private readonly records: ViewportDiagnosticRecord[] = []

  constructor(
    private readonly scheduler: RuntimeScheduler,
    private readonly limit = DEFAULT_DIAGNOSTIC_LIMIT,
  ) {}

  push(
    name: string,
    severity: ViewportDiagnosticRecord['severity'],
    details: Record<string, unknown> = {},
  ): ViewportDiagnosticRecord {
    const record = {
      name,
      severity,
      timestamp: this.scheduler.now(),
      details,
    }
    this.records.push(record)

    if (this.records.length > this.limit) {
      this.records.shift()
    }

    return record
  }

  getRecords(): ViewportDiagnosticRecord[] {
    return [...this.records]
  }
}
