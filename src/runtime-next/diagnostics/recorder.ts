import type {
  RuntimeNextDiagnosticRecord,
  RuntimeNextDiagnosticSeverity,
} from './types'

export type DiagnosticRecorderOptions = {
  readonly limit?: number
  readonly now?: () => number
  readonly onRecord?: (record: RuntimeNextDiagnosticRecord) => void
}

export class DiagnosticRecorder {
  readonly #limit: number
  readonly #now: () => number
  readonly #onRecord: (record: RuntimeNextDiagnosticRecord) => void
  readonly #records: RuntimeNextDiagnosticRecord[] = []
  #nextSequence = 1

  constructor(options: DiagnosticRecorderOptions = {}) {
    this.#limit = options.limit ?? 120
    this.#now = options.now ?? Date.now
    this.#onRecord = options.onRecord ?? noop
  }

  record(input: {
    readonly kind: RuntimeNextDiagnosticRecord['kind']
    readonly message: string
    readonly severity?: RuntimeNextDiagnosticSeverity
    readonly owner?: RuntimeNextDiagnosticRecord['owner']
    readonly viewport?: RuntimeNextDiagnosticRecord['viewport']
    readonly details?: Readonly<Record<string, unknown>>
  }): RuntimeNextDiagnosticRecord {
    const sequence = this.#nextSequence
    this.#nextSequence += 1
    const record: RuntimeNextDiagnosticRecord = {
      id: `${input.kind}:${sequence}:${this.#now()}`,
      severity: input.severity ?? 'info',
      kind: input.kind,
      message: input.message,
      owner: input.owner,
      viewport: input.viewport,
      details: input.details,
    }

    this.#records.push(record)
    while (this.#records.length > this.#limit) {
      this.#records.shift()
    }
    this.#onRecord(record)

    return record
  }

  getRecords(): RuntimeNextDiagnosticRecord[] {
    return [...this.#records]
  }
}

function noop(): void {}
