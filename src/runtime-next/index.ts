import type { RuntimeNextModuleStatus } from './moduleStatus.types'
export { MessageViewportRuntime } from './MessageViewportRuntime'
export { isProjectionCommitTokenEqual } from './projection/commitToken'
export {
  RuntimeNextCustomScrollbar,
  RuntimeNextMessageRowProjection,
  RuntimeNextMessageViewport,
  computeRuntimeNextScrollbarGeometry,
  useMessageViewportRuntime,
  usePhysicalScrollMetrics,
  type RuntimeNextCustomScrollbarProps,
  type RuntimeNextMessageRowProjectionProps,
  type RuntimeNextMessageViewportProps,
  type RuntimeNextScrollbarGeometry,
  type RuntimeNextScrollbarGeometryOptions,
} from './components'

// P5 已接入 input / motion / runtime-next adapter；demo 默认切换仍留给 P6。
export const RUNTIME_NEXT_STATUS: RuntimeNextModuleStatus = {
  phase: 'P5_INPUT_SCROLLBAR_AND_MOTION',
  geometryImplemented: true,
  importsDeprecatedRuntime: false,
}

export type * from './types'
