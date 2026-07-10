import type {
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from './identity'
import type { ProjectionCommitToken } from './snapshot'
import type {
  DestinationCancelledEvent,
  DestinationSettledEvent,
  ProjectionSettledEvent,
  ViewportNavigationIntentEvent,
} from './orchestrationEvents'
export type {
  DestinationCancelledEvent,
  DestinationSettledEvent,
  ProjectionSettledEvent,
  ViewportNavigationIntentEvent,
} from './orchestrationEvents'

/** viewport observation 里暴露的滚动来源分类。 */
type ViewportScrollSource =
  /** 用户主动输入触发的当前帧滚动。 */
  | 'user'
  /** 用户输入后的惯性/动量滚动。 */
  | 'momentum'
  /** runtime 或宿主程序性写入 scrollTop。 */
  | 'programmatic'
  /** runtime 为保持锚点稳定执行的恢复性 scrollTop 写入。 */
  | 'recovery'
  /** jump 命令触发的滚动。 */
  | 'jump'
  /** follow-bottom 语义触发的滚动。 */
  | 'followBottom'
  /** underflow fill 补齐短窗口后触发的滚动。 */
  | 'underflowFill'

/** need* event 的公共字段；只表达 runtime 需要数据，请求、去重、失败回报由 host/session-registry 完成。 */
export type NeedEventBase = {
  /** 发出请求的 session。 */
  sessionId: string
  /** 发出请求时的数据 generation。 */
  generation: number
  /** 发出请求时的 segment revision。 */
  segmentRevision: number
  /** 本次请求 token，数据层回填 segment 或失败时需要带回。 */
  requestToken: string
  /** 触发请求的 runtime 原因。 */
  reason: string
}

/** before 侧需要更多历史数据。 */
export type NeedMoreBeforeEvent = NeedEventBase & {
  /** 事件类型。 */
  type: 'needMoreBefore'
  /** 固定为 before。 */
  edge: 'before'
}

/** after 侧需要更多后续数据。 */
export type NeedMoreAfterEvent = NeedEventBase & {
  /** 事件类型。 */
  type: 'needMoreAfter'
  /** 固定为 after。 */
  edge: 'after'
}

/** 需要重置到源最新窗口。 */
export type NeedLatestMessagesEvent = NeedEventBase & {
  /** 事件类型。 */
  type: 'needLatestMessages'
}

/** 需要围绕指定目标加载数据窗口。 */
export type NeedMessagesAroundEvent = NeedEventBase & {
  /** 事件类型。 */
  type: 'needMessagesAround'
  /** jump/restore 的目标消息身份。 */
  target: MessageIdentityAnchor
}

/** viewport 当前锚点发生变化。 */
export type ViewportAnchorChangedEvent = {
  /** 事件类型。 */
  type: 'viewportAnchorChanged'
  /** 当前 session。 */
  sessionId: string
  /** 当前数据 generation。 */
  generation: number
  /** 当前 segment revision。 */
  segmentRevision: number
  /** 锚点变化来源。 */
  reason:
    /** 滚动帧采样后发布的锚点。 */
    | 'scroll-idle'
    /** projection/motion settle 后发布的锚点。 */
    | 'transaction-settle'
    /** scroll container 分离时发布的最后锚点。 */
    | 'detach'
  /** 当前可解析锚点；不可解析时为 null。 */
  anchor: MessageIdentityAnchor | null
  /** 锚点消息内部的垂直偏移。 */
  offsetWithinMessage?: number
}

/** viewport 可见范围、锚点和滚动来源的观测事件。 */
export type ViewportObservationChangedEvent = {
  /** 事件类型。 */
  type: 'viewportObservationChanged'
  /** 当前 session。 */
  sessionId: string
  /** 当前数据 generation。 */
  generation: number
  /** 当前 segment revision。 */
  segmentRevision: number
  /** 触发本次观测的原因。 */
  reason: ViewportObservationReason
  /** 本次观测对应的滚动来源；detach 等场景可为 null。 */
  scrollSource: ViewportScrollSource | null
  /** 相比上次 observation 的滚动方向。 */
  direction: ViewportScrollDirection
  /** 本次 observation 的活动分类。 */
  activity: ViewportObservationActivity
  /** 本次观测解析出的 viewport anchor。 */
  anchor: MessageIdentityAnchor | null
  /** anchor 消息内部的垂直偏移。 */
  offsetWithinMessage?: number
  /** 观测时距离 native bottom 的像素距离，由已完成的 runtime measurement 提供。 */
  distanceToBottom: number
  /** 本次测量可见 row 的首尾 key。 */
  visibleRange: ViewportVisibleRange
  /** 本次 DOM 测量窗口内的可见 row，不代表完整 loaded segment。 */
  visibleItems: ViewportObservedItem[]
  /** visibleItems 的 key 列表，便于日志和测试断言。 */
  visibleKeys: string[]
}

/** viewport observation 的触发原因。 */
export type ViewportObservationReason =
  /** projection/motion settle 后的观测。 */
  | 'transaction-settle'
  /** 滚动帧采样后的观测。 */
  | 'scroll-idle'
  /** resize 测量和修正后的观测。 */
  | 'resize'
  /** scroll container 分离时的观测。 */
  | 'detach'

/** viewport 滚动方向。 */
export type ViewportScrollDirection =
  /** scrollTop 变小，视口向历史方向移动。 */
  | 'up'
  /** scrollTop 变大，视口向最新方向移动。 */
  | 'down'
  /** scrollTop 相比上次 observation 未变化。 */
  | 'none'

/** viewport observation 对应的活动类型。 */
export type ViewportObservationActivity =
  /** 用户或动量滚动相关的 observation。 */
  | 'scrolling'
  /** transaction/motion settle 相关的 observation。 */
  | 'settling'
  /** resize 测量相关的 observation。 */
  | 'resizing'
  /** detach 相关的 observation。 */
  | 'detached'

/** 本次测量可见 row 的首尾范围。 */
export type ViewportVisibleRange = {
  /** 第一个可见 row key；无可见 row 时为 null。 */
  firstKey: MessageRuntimeItemKey | null
  /** 最后一个可见 row key；无可见 row 时为 null。 */
  lastKey: MessageRuntimeItemKey | null
}

/** 单个可见 row 的观测结果。 */
export type ViewportObservedItem = {
  /** row 运行时 key。 */
  key: MessageRuntimeItemKey
  /** row 可见比例，范围为 0 到 1。 */
  visibleRatio: number
}

/** runtime 建议数据层考虑裁剪窗口的事件。 */
export type SegmentTrimPressureEvent = {
  /** 事件类型。 */
  type: 'segmentTrimPressure'
  /** 当前 session。 */
  sessionId: string
  /** 当前数据 generation。 */
  generation: number
  /** 当前 segment revision。 */
  segmentRevision: number
  /** 当前 segment item 数。 */
  itemCount: number
  /** 当前 viewport anchor。 */
  anchor: MessageIdentityAnchor | null
  /** 当前 viewport anchor 对应的 row key。 */
  anchorKey: MessageRuntimeItemKey | null
  /** anchor 前的 item 数。 */
  itemsBeforeAnchor: number
  /** anchor 后的 item 数。 */
  itemsAfterAnchor: number
  /** 当前测量窗口内 anchor 到 before 侧的像素距离；不可估算时为 null。 */
  distanceBeforeAnchorPx: number | null
  /** 当前测量窗口内 anchor 到 after 侧的像素距离；不可估算时为 null。 */
  distanceAfterAnchorPx: number | null
  /** 粗略 DOM 成本估算，目前等于 itemCount。 */
  estimatedDomCost: number
  /** runtime 给数据层的建议裁剪方向，不是自动执行的裁剪命令。 */
  preferredTrimSide:
    /** 建议裁剪 before 侧窗口。 */
    | 'before'
    /** 建议裁剪 after 侧窗口。 */
    | 'after'
}

/** runtime 诊断事件。 */
export type ViewportDiagnosticEvent = {
  /** 事件类型。 */
  type: 'viewportDiagnostic'
  /** 诊断记录。 */
  record: ViewportDiagnosticRecord
}

/** 当前 generation 首次完成 settled commit 后发出的 ready 事件。 */
export type ViewportReadyEvent = {
  /** 事件类型。 */
  type: 'viewportReady'
  /** 当前 session。 */
  sessionId: string
  /** 触发 ready 的 projection commit token。 */
  commitToken: ProjectionCommitToken
}

/** runtime 错误事件。 */
export type ViewportErrorEvent = {
  /** 事件类型。 */
  type: 'viewportError'
  /** 当前 session。 */
  sessionId: string
  /** 错误代码。 */
  code: string
  /** 面向开发者的错误信息。 */
  message: string
}

/** runtime 对外发布的所有事件联合。 */
export type MessageListRuntimeEvent =
  | NeedMoreBeforeEvent
  | NeedMoreAfterEvent
  | NeedLatestMessagesEvent
  | NeedMessagesAroundEvent
  | DestinationCancelledEvent
  | ViewportNavigationIntentEvent
  | DestinationSettledEvent
  | SegmentTrimPressureEvent
  | ViewportAnchorChangedEvent
  | ViewportObservationChangedEvent
  | ViewportDiagnosticEvent
  | ViewportReadyEvent
  | ProjectionSettledEvent
  | ViewportErrorEvent

/** runtime event 订阅回调。 */
export type MessageListRuntimeEventListener = (event: MessageListRuntimeEvent) => void

/** viewport observation 专用订阅回调。 */
export type ViewportObservationListener = (event: ViewportObservationChangedEvent) => void

/** runtime 诊断记录。 */
export type ViewportDiagnosticRecord = {
  /** 诊断名称，通常使用 namespace.action 格式。 */
  name: string
  /** 诊断严重级别。 */
  severity:
    /** 调试采样或低级别运行证据。 */
    | 'debug'
    /** 重要但预期内的运行状态。 */
    | 'info'
    /** 可恢复但需要关注的异常路径。 */
    | 'warn'
    /** runtime 语义失败或超时错误。 */
    | 'error'
  /** 诊断产生时间，来自 runtime scheduler.now。 */
  timestamp: number
  /** 诊断详情载荷。 */
  details: Record<string, unknown>
}
