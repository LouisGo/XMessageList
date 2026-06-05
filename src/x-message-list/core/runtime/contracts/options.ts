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
  sessionId?: string
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

/**
 * 由调用方提供的滚动来源提示，只影响 motion 方向和跨 session 预定位策略，不改变数据请求语义。
 */
export type MessageListScrollMotionHint = {
  /** 触发跳转的来源锚点，用于后续扩展更精细的 motion 决策。 */
  origin?: import('./identity').MessageIdentityAnchor
  /** 调用方已知的目标方向；reset 后的 motion 可用它约束启动侧。 */
  direction?: MessageListMotionDirection
  /** 跨 session 跳转不做 bounded preposition，避免先闪到当前 session 的错误相对位置。 */
  crossSession?: boolean
}

export type MessageListScrollToMessageOptions = MessageListScrollOptions & {
  align?: 'start' | 'center' | 'end' | 'nearest'
  motion?: MessageListScrollMotionHint
}

export type MessageListRestoreOptions = {
  align?: 'start' | 'center' | 'end'
  offsetWithinMessage?: number
}

export type ScrollMotionEnabled = boolean | (() => boolean)

/**
 * runtime 自管滚动动画的边界配置。关闭动画或命中 reduced-motion 时，会同步写入目标 scrollTop 并完成 settle。
 */
export type ScrollMotionOptions = {
  /** 是否启用 JS bounded motion；false 时直接落到目标位置。 */
  enabled?: ScrollMotionEnabled
  /** 是否尊重系统 reduced-motion 偏好。 */
  respectReducedMotion?: boolean
  /** 单次动画前允许保留的最大可见滚动距离，超出时先做 bounded preposition。 */
  maxDistancePx?: number
  /** 距离很短时的最小时长。 */
  minDurationMs?: number
  /** 距离达到 maxDistancePx 时的最大时长。 */
  maxDurationMs?: number
  /** 小于该距离时视为已到达目标。 */
  targetEpsilonPx?: number
}
