export type RuntimeScheduler = {
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
  setTimeout(callback: () => void, timeoutMs: number): number
  clearTimeout(handle: number): void
  now(): number
}

export type RuntimeObserverFactory = {
  createResizeObserver(callback: ResizeObserverCallback): ResizeObserver
  createIntersectionObserver(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ): IntersectionObserver
}

export type MessageListRuntimeOptions = {
  feedId?: string
  scheduler?: RuntimeScheduler
  observers?: RuntimeObserverFactory
  commitTimeoutMs?: number
  bottomLockThresholdPx?: number
  bottomUnlockThresholdPx?: number
  edgeActivationMarginPx?: number
  underflowTolerancePx?: number
  scrollMotion?: ScrollMotionOptions
}

export type MessageListScrollOptions = {
  behavior?: ScrollBehavior
}

export type MessageListMotionDirection = 'before' | 'after' | 'none'

export type MessageListScrollMotionHint = {
  origin?: import('./identity').MessageIdentityAnchor
  direction?: MessageListMotionDirection
  crossFeed?: boolean
}

export type MessageListScrollToMessageOptions = MessageListScrollOptions & {
  align?: 'start' | 'center' | 'end' | 'nearest'
  motion?: MessageListScrollMotionHint
}

export type MessageListRestoreOptions = {
  align?: 'start' | 'center' | 'end'
  offsetWithinMessage?: number
}

export type ScrollMotionOptions = {
  enabled?: boolean
  respectReducedMotion?: boolean
  maxDistancePx?: number
  minDurationMs?: number
  maxDurationMs?: number
  targetEpsilonPx?: number
}
