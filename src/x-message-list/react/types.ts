import type { CSSProperties, ReactNode } from 'react'
import type {
  MessageListAnchor,
  MessageListLoadedContext,
  MessageListOverlayStatus,
  MessageListReloadCurrentOptions,
  MessageListReloadCurrentResult,
  MessageListResolvedAnchor,
  MessageListScrollToMessageOptions,
  MessageListSession,
} from '../core/session-registry/index'

/** React slot 中暴露的 edge 状态。 */
type ReactEdgeStatus =
  /** 空闲。 */
  | 'idle'
  /** 正在加载。 */
  | 'loading'
  /** 加载失败。 */
  | 'error'
  /** 该侧没有更多数据。 */
  | 'exhausted'
/** React slot 中暴露的底部锁状态。 */
type ReactBottomLockState =
  /** 已锁定源底部。 */
  | 'LOCKED'
  /** 未锁定源底部。 */
  | 'UNLOCKED'
/** React slot 中暴露的 pending intent。 */
type ReactPendingIntent =
  /** before edge 请求等待中。 */
  | 'edge-before'
  /** after edge 请求等待中。 */
  | 'edge-after'
  /** runtime 正在补齐短窗口。 */
  | 'underflow-fill'
  /** follow-bottom/latest 请求等待中。 */
  | 'follow-bottom'
  /** jump/restore around 请求或 DOM settle 等待中。 */
  | 'destination'
/** React slot 中暴露的 viewport phase。 */
type ReactViewportPhase =
  /** 空闲。 */
  | 'IDLE'
  /** 等待 React commit ack。 */
  | 'PROJECTING'
  /** 读取 DOM metrics。 */
  | 'MEASURING'
  /** 修正 scrollTop。 */
  | 'CORRECTING'
  /** 执行 JS bounded motion。 */
  | 'MOTION'
/** viewport 观测事件中的滚动来源。 */
type ReactViewportScrollSource =
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

/** before/after edge slot 的输入。 */
export type EdgeSlotInput = {
  /** 当前 edge 状态。 */
  status: ReactEdgeStatus
  /** 重试该 edge 请求。 */
  retry: () => void
}

/** overlay slot 的输入。 */
export type OverlayStatusInput = MessageListOverlayStatus

/** empty slot 的输入。 */
export type EmptySlotInput = {
  /** 重新加载 latest 窗口。 */
  reload: () => void
}

/** scroll-to-latest slot 的输入。 */
export type ScrollToLatestSlotInput = {
  /** 是否因滚动距离/hasMoreAfter/pending 状态应显示入口。 */
  visibleByScroll: boolean
  /** 当前 loaded rows 的语义上下文。 */
  loadedContext: MessageListLoadedContext
  /** 执行 scroll-to-latest 命令。 */
  scrollToLatest: () => void
  /** 当前底部锁状态。 */
  bottomLockState: ReactBottomLockState
  /** after 侧是否还有更多数据。 */
  hasMoreAfter: boolean
  /** 当前 pending intent。 */
  pendingIntent: ReactPendingIntent | null
  /** 当前 viewport phase。 */
  viewportPhase: ReactViewportPhase
}

/** React 层转发的 viewport anchor 变化事件。 */
export type MessageListViewportAnchorChangeEvent = {
  /** 事件类型。 */
  type: 'viewportAnchorChanged'
  /** 当前 session。 */
  sessionId: string
  /** 当前 generation。 */
  generation: number
  /** 当前 segment revision。 */
  segmentRevision: number
  /** 锚点变化来源。 */
  reason:
    /** 滚动帧采样后发布。 */
    | 'scroll-idle'
    /** projection/motion settle 后发布。 */
    | 'transaction-settle'
    /** scroll container 分离时发布。 */
    | 'detach'
  /** 当前 viewport anchor。 */
  anchor: MessageListResolvedAnchor | null
  /** anchor 消息内部垂直偏移。 */
  offsetWithinMessage?: number
}

/** React 层转发的 viewport observation 事件。 */
export type MessageListViewportObservationEvent = {
  /** 事件类型。 */
  type: 'viewportObservationChanged'
  /** 当前 session。 */
  sessionId: string
  /** 当前 generation。 */
  generation: number
  /** 当前 segment revision。 */
  segmentRevision: number
  /** observation 触发原因。 */
  reason:
    /** projection/motion settle 后观测。 */
    | 'transaction-settle'
    /** 滚动帧采样后观测。 */
    | 'scroll-idle'
    /** resize 后观测。 */
    | 'resize'
    /** detach 时观测。 */
    | 'detach'
  /** 滚动来源；detach 等场景可为 null。 */
  scrollSource: ReactViewportScrollSource | null
  /** 相比上次 observation 的滚动方向。 */
  direction:
    /** scrollTop 变小。 */
    | 'up'
    /** scrollTop 变大。 */
    | 'down'
    /** scrollTop 未变化。 */
    | 'none'
  /** observation 活动分类。 */
  activity:
    /** 滚动相关。 */
    | 'scrolling'
    /** settle 相关。 */
    | 'settling'
    /** resize 相关。 */
    | 'resizing'
    /** detach 相关。 */
    | 'detached'
  /** 当前 viewport anchor。 */
  anchor: MessageListResolvedAnchor | null
  /** anchor 消息内部垂直偏移。 */
  offsetWithinMessage?: number
  /** 观测时距离 native bottom 的像素距离。 */
  distanceToBottom: number
  /** 可见 row 首尾 key。 */
  visibleRange: {
    /** 第一个可见 row key。 */
    firstKey: string | null
    /** 最后一个可见 row key。 */
    lastKey: string | null
  }
  /** 本次测量窗口里的可见 row。 */
  visibleItems: Array<{
    /** row key。 */
    key: string
    /** 可见比例，0 到 1。 */
    visibleRatio: number
  }>
  /** visibleItems 的 key 列表。 */
  visibleKeys: string[]
}

/** MessageList session commands 的 React 侧类型形状。 */
export type MessageListCommands<Row = unknown> = {
  /** 滚动或加载到源最新。 */
  scrollToLatest: () => void
  /** 滚动或加载到指定消息；options 未传时 align 默认 center。 */
  scrollToMessage: (
    target: MessageListAnchor,
    options?: MessageListScrollToMessageOptions,
  ) => void
  /** 手动加载 before 侧。 */
  loadBefore: () => void
  /** 手动加载 after 侧。 */
  loadAfter: () => void
  /** 重新加载 latest 窗口。 */
  reloadLatest: () => void
  /** 静默按当前视觉锚点执行结构重载，并等待 projection settle。 */
  reloadCurrent: (
    options: MessageListReloadCurrentOptions,
  ) => Promise<MessageListReloadCurrentResult<Row>>
}

/** renderRow 回调输入。 */
export type MessageListRenderRowInput<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  /** 业务 row，即 item.message。 */
  row: TMessage
  /** runtime 渲染 item。 */
  item: MessageListRenderItem<TMessage, TOptimistic>
}

/** React 渲染层消费的 row item。 */
export type MessageListRenderItem<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  /** 当前投影 DOM row key。 */
  key: string
  /** row 类型。 */
  rowKind:
    /** 普通消息 row。 */
    | 'message'
    /** 日期分隔 row。 */
    | 'date-separator'
    /** 系统提示 row。 */
    | 'system'
    /** 已删除消息占位 row。 */
    | 'deleted-placeholder'
    /** 权限不可访问消息占位 row。 */
    | 'permission-fallback'
  /** row 对应消息身份。 */
  identity?: {
    /** 所属 session。 */
    sessionId: string
    /** 稳定消息 id。 */
    stableId: string
    /** 服务端消息 id。 */
    serverId?: string
    /** 本地乐观消息 id。 */
    localId?: string
    /** 身份或内容版本。 */
    version: number
  }
  /** 渲染版本；变化表示 row 需要重新测量。 */
  renderVersion: number
  /** 业务消息载荷。 */
  message?: TMessage
  /** 乐观消息载荷。 */
  optimistic?: TOptimistic
}

/** MessageList 组件 props。 */
export type MessageListProps<TMessage = unknown, TOptimistic = unknown> = {
  /** 要渲染的 session。 */
  session: MessageListSession<TMessage>
  /** 渲染单个消息 row。 */
  renderRow: (
    input: MessageListRenderRowInput<TMessage, TOptimistic>,
  ) => ReactNode
  /** 自定义 row renderVersion；未传时使用 session adapter 的 row.getVersion 结果。 */
  getRowRenderVersion?: (
    item: MessageListRenderItem<TMessage, TOptimistic>,
  ) => unknown
  /** 根节点 className；未传时不设置 className。 */
  className?: string
  /** 根节点 style；未传时只保留组件内部必需样式。 */
  style?: CSSProperties
  /** before edge 状态 slot；未传时不渲染 before 状态入口。 */
  renderBeforeStatus?: (input: EdgeSlotInput) => ReactNode
  /** after edge 状态 slot；未传时不渲染 after 状态入口。 */
  renderAfterStatus?: (input: EdgeSlotInput) => ReactNode
  /** 顶部占位 slot；未传时不渲染顶部占位。 */
  renderTopPlaceholder?: () => ReactNode
  /** overlay 状态 slot；未传时不渲染 overlay 层。 */
  renderOverlayStatus?: (input: OverlayStatusInput) => ReactNode
  /** 空列表 slot；未传时空窗口不渲染额外 empty 内容。 */
  renderEmpty?: (input: EmptySlotInput) => ReactNode
  /** scroll-to-latest slot；未传时不渲染回到底部入口，也不订阅距离可见性。 */
  renderScrollToLatest?: (input: ScrollToLatestSlotInput) => ReactNode
  /** viewport anchor 变化回调；未传时不转发该事件给宿主。 */
  onViewportAnchorChange?: (event: MessageListViewportAnchorChangeEvent) => void
  /** viewport observation 变化回调；未传时不转发该事件给宿主。 */
  onViewportObservationChange?: (
    event: MessageListViewportObservationEvent,
  ) => void
  /** 滚动条模式；未传时默认 native。 */
  scrollbar?:
    /** 使用浏览器原生滚动条。 */
    | 'native'
    /** 使用 MessageList 自定义滚动条 overlay。 */
    | 'custom'
}
