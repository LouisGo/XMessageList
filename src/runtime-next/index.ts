import type { RuntimeNextModuleStatus } from './moduleStatus.types'
export { MessageViewportRuntime } from './MessageViewportRuntime'
export { isProjectionCommitTokenEqual } from './projection/commitToken'

// P4 将 data/command 与 P3 几何内核接成事务；demo/React cutover 留给后续阶段。
export const RUNTIME_NEXT_STATUS: RuntimeNextModuleStatus = {
  phase: 'P4_TRANSACTION_AND_DATA_ARRIVAL',
  geometryImplemented: true,
  importsDeprecatedRuntime: false,
}

export type * from './types'
