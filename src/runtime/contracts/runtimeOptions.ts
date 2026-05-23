import type { RuntimeDiagnosticsOptions } from './events'
import type { ScrollMotionOptions } from './commands'
import type { WindowConfig } from './snapshot'

export type HeightRecord = {
  height: number
  measuredAtRevision: number
  contentVersion: number
  widthBucket: number
  lastAccessedAt: number
}

export type RuntimeScheduler = {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
  setTimeout(callback: () => void, timeoutMs: number): number
  clearTimeout(handle: number): void
  now(): number
}

export type RuntimeObserverFactory = {
  createResizeObserver(callback: ResizeObserverCallback): ResizeObserver | null
  createIntersectionObserver(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ): IntersectionObserver | null
}

export type MessageViewportRuntimeOptions = {
  feedId?: string
  generation?: number
  window?: WindowConfig
  scrollMotion?: Partial<ScrollMotionOptions>
  debug?: {
    diagnostics?: RuntimeDiagnosticsOptions
  }
  scheduler?: RuntimeScheduler
  observers?: Partial<RuntimeObserverFactory>
  commitTimeoutMs?: Partial<{
    bootstrap: number
    normal: number
    jump: number
  }>
  bottomLockThresholdPx?: number
  bottomUnlockThresholdPx?: number
  edgeLoadThresholdPx?: number
  viewportCompaction?: {
    spacerThresholdPx?: number
    dataWindowItemThreshold?: number
  }
}
