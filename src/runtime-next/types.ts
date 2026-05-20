export type RuntimeNextPhase = 'P1_STRUCTURE_ONLY' | 'P2_CONTRACT_SKELETON'

export type RuntimeNextModuleStatus = {
  readonly phase: RuntimeNextPhase
  readonly geometryImplemented: false
  readonly importsDeprecatedRuntime: false
}

export type RuntimeNextFeedId = string
export type RuntimeNextGeneration = number
export type RuntimeNextRevision = number
export type RuntimeNextSegmentId = string
export type RuntimeNextTransactionId = string

export type RuntimeNextListener = () => void
export type RuntimeNextUnsubscribe = () => void

export type {
  RuntimeNextCommand,
  RuntimeNextCommandTarget,
} from './commands/types'
export type {
  RuntimeNextDataItem,
  RuntimeNextDataSnapshot,
} from './data/types'
export type {
  RuntimeNextArchitectureViolationKind,
  RuntimeNextDiagnosticRecord,
  RuntimeNextDiagnosticSeverity,
} from './diagnostics/types'
export type {
  PhysicalScrollMetrics,
  PhysicalScrollRange,
  PhysicalSegmentCapMode,
} from './geometry/types'
export type {
  MessageViewportSnapshot,
  ProjectionCommitToken,
  ProjectionEdgeState,
  ProjectionRow,
} from './projection/types'
