import type { RuntimeNextModuleStatus } from './types'

// P1 只发布结构占位：这里不能实例化 runtime，也不能转发 deprecated 实现。
export const RUNTIME_NEXT_STATUS: RuntimeNextModuleStatus = {
  phase: 'P1_STRUCTURE_ONLY',
  geometryImplemented: false,
  importsDeprecatedRuntime: false,
}

export type {
  RuntimeNextModuleStatus,
  RuntimeNextPhase,
} from './types'

