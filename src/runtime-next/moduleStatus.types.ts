export type RuntimeNextPhase =
  | 'P1_STRUCTURE_ONLY'
  | 'P2_CONTRACT_SKELETON'
  | 'P3_GEOMETRY_KERNEL_IN_PROGRESS'
  | 'P4_TRANSACTION_AND_DATA_ARRIVAL'
  | 'P5_INPUT_SCROLLBAR_AND_MOTION'

export type RuntimeNextModuleStatus = {
  readonly phase: RuntimeNextPhase
  readonly geometryImplemented: boolean
  readonly importsDeprecatedRuntime: false
}
