export type RuntimeNextDiagnosticSeverity = 'info' | 'warn' | 'error'

export type RuntimeNextArchitectureViolationKind =
  | 'geometry-owner-violation'
  | 'deprecated-runtime-import'
  | 'deprecated-react-import'
  | 'projection-metrics-coupling'
  | 'raw-scroll-height-dependency'
  | 'data-arrival-geometry-mutation'

export type RuntimeNextDiagnosticRecord = {
  readonly id: string
  readonly severity: RuntimeNextDiagnosticSeverity
  readonly kind: RuntimeNextArchitectureViolationKind
  readonly message: string
  readonly owner?: 'commands' | 'data' | 'geometry' | 'projection' | 'react'
  readonly details?: Readonly<Record<string, unknown>>
}

