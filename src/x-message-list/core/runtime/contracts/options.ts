/** runtime 使用的调度器抽象，便于浏览器实现和测试 fake scheduler 共享同一时序接口。 */
export type RuntimeScheduler = {
  /** 安排下一帧回调。 */
  requestAnimationFrame(callback: FrameRequestCallback): number
  /** 取消已安排的帧回调。 */
  cancelAnimationFrame(handle: number): void
  /** 安排超时回调。 */
  setTimeout(callback: () => void, timeoutMs: number): number
  /** 取消已安排的超时回调。 */
  clearTimeout(handle: number): void
  /** 返回当前单调时间，优先对应 performance.now 语义。 */
  now(): number
}

/** runtime 使用的 DOM observer 工厂；测试环境可注入空实现或 fake observer。 */
export type RuntimeObserverFactory = {
  /** 创建 ResizeObserver，用于行高和容器尺寸变化。 */
  createResizeObserver(callback: ResizeObserverCallback): ResizeObserver
  /** 创建 IntersectionObserver，用于 before/after edge trigger。 */
  createIntersectionObserver(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ): IntersectionObserver
}

/** MessageList viewport runtime 的初始化配置。 */
export type MessageListRuntimeOptions = {
  /** 当前 runtime 所属 session；未传时默认 default。 */
  sessionId?: string
  /** 自定义调度器；未传时使用浏览器/默认 scheduler。 */
  scheduler?: RuntimeScheduler
  /** 自定义 observer 工厂；未传时使用浏览器原生 observer。 */
  observers?: RuntimeObserverFactory
  /** React projection commit ack 的等待超时；未传时默认 120ms，超时后发 viewportError。 */
  commitTimeoutMs?: number
  /** 距离底部小于等于该值时允许进入 LOCKED；未传时默认 40px。 */
  bottomLockThresholdPx?: number
  /** 用户向上离开底部超过该值时解除 LOCKED；未传时默认 120px。 */
  bottomUnlockThresholdPx?: number
  /** edge trigger 的可视激活边距；未传时默认 min(max(clientHeight * 0.25, 64), 240)。 */
  edgeActivationMarginPx?: number
  /** scrollHeight 小于 clientHeight 的容差，用于 underflow fill 判断；未传时默认 2px。 */
  underflowTolerancePx?: number
  /** runtime 自管滚动动画配置；未传时使用 ScrollMotionOptions 的默认值。 */
  scrollMotion?: ScrollMotionOptions
}

/** 通用滚动命令选项；保留 behavior 作为宿主兼容字段，runtime 当前不直接使用原生 smooth。 */
export type MessageListScrollOptions = {
  /** 宿主传入的滚动行为提示；未传时不附加行为提示。 */
  behavior?: ScrollBehavior
}

/** 调用方已知的消息方向，用于约束 reset 后 motion 从哪一侧进入目标。 */
export type MessageListMotionDirection =
  /** 目标位于当前窗口 before 侧。 */
  | 'before'
  /** 目标位于当前窗口 after 侧。 */
  | 'after'
  /** 调用方没有方向约束。 */
  | 'none'

/**
 * 由调用方提供的滚动来源提示，只影响 motion 方向和跨 session 预定位策略，不改变数据请求语义。
 */
export type MessageListScrollMotionHint = {
  /** 触发跳转的来源锚点；未传时不提供来源锚点。 */
  origin?: import('./identity').MessageIdentityAnchor
  /** 调用方已知的目标方向；未传时 runtime 从当前/目标位置推导。 */
  direction?: MessageListMotionDirection
  /** 是否跨 session；未传时按 false 处理。 */
  crossSession?: boolean
}

/** scrollToMessage 的命令选项。 */
export type MessageListScrollToMessageOptions = MessageListScrollOptions & {
  /** 目标消息在视口中的对齐方式；未传时默认 center。 */
  align?:
    /** 目标顶部对齐视口顶部。 */
    | 'start'
    /** 目标居中对齐视口。 */
    | 'center'
    /** 目标底部对齐视口底部。 */
    | 'end'
    /** 若目标已完整可见则不滚动，否则选择移动距离较小的一侧对齐。 */
    | 'nearest'
  /** 额外 motion 提示；未传时不附加 motion 提示，不改变数据请求语义。 */
  motion?: MessageListScrollMotionHint
}

/** restoreToMessage 的命令选项，用于按保存的锚点 offset 恢复视口。 */
export type MessageListRestoreOptions = {
  /** 目标消息在视口中的对齐方式；未传时默认 center，restore 不支持 nearest。 */
  align?:
    /** 目标顶部对齐视口顶部。 */
    | 'start'
    /** 目标居中对齐视口。 */
    | 'center'
    /** 目标底部对齐视口底部。 */
    | 'end'
  /** 锚点消息内部的垂直偏移；未传时不使用消息内部偏移，按 align 对齐。 */
  offsetWithinMessage?: number
}

/** 是否启用 runtime JS motion；函数形式会在每次启动 motion 时求值。 */
export type ScrollMotionEnabled = boolean | (() => boolean)

/**
 * runtime 自管滚动动画的边界配置。关闭动画或命中 reduced-motion 时，会同步写入目标 scrollTop 并完成 settle。
 */
export type ScrollMotionOptions = {
  /** 是否启用 JS bounded motion；未传时默认 true，false 时直接落到目标位置。 */
  enabled?: ScrollMotionEnabled
  /** 是否尊重系统 reduced-motion 偏好；未传时默认 true。 */
  respectReducedMotion?: boolean
  /** 单次动画前允许保留的最大可见滚动距离；未传时默认 800px，超出时先做 bounded preposition。 */
  maxDistancePx?: number
  /** 距离很短时的最小时长；未传时默认 300ms。 */
  minDurationMs?: number
  /** 距离达到 maxDistancePx 时的最大时长；未传时默认 600ms。 */
  maxDurationMs?: number
  /** 小于该距离时视为已到达目标；未传时默认 1px。 */
  targetEpsilonPx?: number
}
