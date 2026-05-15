import type {
  DiagnosticChannel,
  DiagnosticSeverity,
  RuntimeDiagnosticsOptions,
  RuntimeState,
  ViewportDiagnosticEvent,
  ViewportDiagnosticRecord,
} from '../types'

type DiagnosticRuntimeContext = {
  feedId: string
  generation: number
  state: RuntimeState
  readySubstate: string
  pendingCommands: number
}

type NormalizedDiagnosticOptions = {
  enabled: boolean
  channels: 'all' | Set<DiagnosticChannel>
  minSeverity: DiagnosticSeverity
  maxEntries: number
  emitEvents: boolean
  sampleRate: number
}

export type RuntimeDiagnosticInput = {
  channel: DiagnosticChannel
  severity?: DiagnosticSeverity
  name: string
  correlationId?: string
  details?: () => Record<string, unknown>
}

const DEFAULT_MAX_ENTRIES = 500

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export class DiagnosticRecorder {
  private readonly options: NormalizedDiagnosticOptions

  private readonly records: ViewportDiagnosticRecord[] = []

  constructor(
    options: RuntimeDiagnosticsOptions | undefined,
    private readonly now: () => number,
    private readonly getContext: () => DiagnosticRuntimeContext,
    private readonly emitEvent: (event: ViewportDiagnosticEvent) => void,
  ) {
    this.options = normalizeDiagnosticOptions(options)
  }

  isEnabled(channel: DiagnosticChannel, severity: DiagnosticSeverity): boolean {
    if (!this.options.enabled) {
      return false
    }

    if (SEVERITY_RANK[severity] < SEVERITY_RANK[this.options.minSeverity]) {
      return false
    }

    if (
      this.options.channels !== 'all' &&
      !this.options.channels.has(channel)
    ) {
      return false
    }

    return this.options.sampleRate >= 1 || Math.random() <= this.options.sampleRate
  }

  emit(input: RuntimeDiagnosticInput): void {
    const severity = input.severity ?? 'debug'

    if (!this.isEnabled(input.channel, severity)) {
      return
    }

    const context = this.getContext()
    const record: ViewportDiagnosticRecord = {
      feedId: context.feedId,
      generation: context.generation,
      channel: input.channel,
      severity,
      name: input.name,
      correlationId: input.correlationId,
      timestamp: this.now(),
      details: {
        state: context.state,
        readySubstate: context.readySubstate,
        pendingCommands: context.pendingCommands,
        ...(input.details?.() ?? {}),
      },
    }

    if (this.options.maxEntries > 0) {
      this.records.push(record)

      if (this.records.length > this.options.maxEntries) {
        this.records.splice(0, this.records.length - this.options.maxEntries)
      }
    }

    if (this.options.emitEvents) {
      this.emitEvent({
        type: 'viewportDiagnostic',
        ...record,
      })
    }
  }

  getRecords(): ViewportDiagnosticRecord[] {
    return this.records.map((record) => ({
      ...record,
      details: { ...record.details },
    }))
  }
}

function normalizeDiagnosticOptions(
  options: RuntimeDiagnosticsOptions | undefined,
): NormalizedDiagnosticOptions {
  if (typeof options === 'boolean') {
    return {
      enabled: options,
      channels: 'all',
      minSeverity: 'debug',
      maxEntries: DEFAULT_MAX_ENTRIES,
      emitEvents: true,
      sampleRate: 1,
    }
  }

  if (!options) {
    return {
      enabled: false,
      channels: 'all',
      minSeverity: 'debug',
      maxEntries: DEFAULT_MAX_ENTRIES,
      emitEvents: true,
      sampleRate: 1,
    }
  }

  return {
    enabled: options.enabled ?? true,
    channels:
      !options.channels || options.channels === 'all'
        ? 'all'
        : new Set(options.channels),
    minSeverity: options.minSeverity ?? 'debug',
    maxEntries: Math.max(0, options.maxEntries ?? DEFAULT_MAX_ENTRIES),
    emitEvents: options.emitEvents ?? true,
    sampleRate: clampSampleRate(options.sampleRate ?? 1),
  }
}

function clampSampleRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.max(0, Math.min(1, value))
}
