import type { ViewportDiagnostics } from '../geometry/types'

export type RuntimeNextDiagnosticSeverity = 'info' | 'warn' | 'error'

export type RuntimeNextArchitectureViolationKind =
  | 'transaction-lifecycle'
  | 'transaction-error'
  | 'writer-arbitration'
  | 'data-classifier-intent'
  | 'geometry-owner-violation'
  | 'deprecated-runtime-import'
  | 'deprecated-react-import'
  | 'root-entry-import'
  | 'package-self-reference'
  | 'projection-metrics-coupling'
  | 'raw-scroll-height-dependency'
  | 'data-arrival-geometry-mutation'
  | 'scroll-height-cap-exceeded'
  | 'spacer-only-viewport'
  | 'real-row-coverage-insufficient'
  | 'same-revision-spacer-oscillation'
  | 'segment-shift-loop'
  | 'thumb-geometry-data-coupling'
  | 'drag-lock-stolen'
  | 'pending-segment-revision-exposed'
  | 'momentum-residual-shift-loop'

export type RuntimeNextDiagnosticRecord = {
  readonly id: string
  readonly severity: RuntimeNextDiagnosticSeverity
  readonly kind: RuntimeNextArchitectureViolationKind
  readonly message: string
  readonly owner?:
    | 'commands'
    | 'data'
    | 'geometry'
    | 'projection'
    | 'react'
    | 'scroll'
    | 'transactions'
  readonly viewport?: ViewportDiagnostics
  readonly details?: Readonly<Record<string, unknown>>
}

export type ViewportDiagnosticRecord = RuntimeNextDiagnosticRecord
