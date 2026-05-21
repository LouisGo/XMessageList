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

// P6 将 demo/default entry 切到 runtime-next；旧 runtime 仅保留为参考备份。
export const RUNTIME_NEXT_STATUS: RuntimeNextModuleStatus = {
  phase: 'P6_DEMO_DEFAULT_RUNTIME_NEXT',
  geometryImplemented: true,
  importsDeprecatedRuntime: false,
}

export type * from './types'
