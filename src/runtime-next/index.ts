import type { RuntimeNextModuleStatus } from './types'
export { MessageViewportRuntime } from './MessageViewportRuntime'
export { isProjectionCommitTokenEqual } from './projection/commitToken'

// P2 仍是合同骨架：runtime-next 不实例化 deprecated runtime，也不发布真实 geometry。
export const RUNTIME_NEXT_STATUS: RuntimeNextModuleStatus = {
  phase: 'P2_CONTRACT_SKELETON',
  geometryImplemented: false,
  importsDeprecatedRuntime: false,
}

export type * from './types'
