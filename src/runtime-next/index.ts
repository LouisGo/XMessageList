import type { RuntimeNextModuleStatus } from './moduleStatus.types'
export { MessageViewportRuntime } from './MessageViewportRuntime'
export { isProjectionCommitTokenEqual } from './projection/commitToken'

// P3 内部几何内核开始落地；facade 仍不发布完整 runtime geometry。
export const RUNTIME_NEXT_STATUS: RuntimeNextModuleStatus = {
  phase: 'P3_GEOMETRY_KERNEL_IN_PROGRESS',
  geometryImplemented: false,
  importsDeprecatedRuntime: false,
}

export type * from './types'
