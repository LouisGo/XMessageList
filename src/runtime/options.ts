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
}

export type MessageListScrollOptions = {
  behavior?: ScrollBehavior
}

export type MessageListScrollToMessageOptions = MessageListScrollOptions & {
  align?: 'start' | 'center' | 'end' | 'nearest'
}

export type MessageListRestoreOptions = {
  align?: 'start' | 'center' | 'end'
}
