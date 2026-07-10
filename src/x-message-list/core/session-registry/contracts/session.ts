import type {
  MessageListAlign,
  MessageListAnchor,
  MessageListBottomLockState,
  MessageListEdgeStatus,
  MessageListLoadedContext,
  MessageListPage,
  MessageListPendingIntent,
  MessageListScrollToMessageOptions,
  MessageListSessionId,
  MessageListSessionRegistryOptionsPatch,
  MessageListSessionSource,
  MessageListViewportPhase,
} from './base'
import type { MessageListOverlayStatus } from './base'

/** 单个 session 对外暴露的状态快照。 */
export type MessageListSessionState<Row = unknown> = {
  /** 当前 session id。 */
  sessionId: MessageListSessionId
  /** 当前已加载 row 窗口。 */
  loaded: {
    /** 当前窗口 row。 */
    rows: Row[]
    /** 当前窗口 row key。 */
    keys: string[]
    /** before 侧是否还有更多数据。 */
    hasMoreBefore: boolean
    /** after 侧是否还有更多数据。 */
    hasMoreAfter: boolean
    /** 当前 loaded rows 的语义上下文。 */
    context: MessageListLoadedContext
  }
  /** before/after edge 状态。 */
  edge: {
    /** before 侧 edge 状态。 */
    before: { /** before 侧加载状态。 */ status: MessageListEdgeStatus }
    /** after 侧 edge 状态。 */
    after: { /** after 侧加载状态。 */ status: MessageListEdgeStatus }
  }
  /** 当前 overlay 状态。 */
  overlayStatus: MessageListOverlayStatus
  /** 当前 viewport 状态。 */
  viewport: {
    /** 是否锁定源底部。 */
    bottomLockState: MessageListBottomLockState
    /** runtime 当前等待完成的意图。 */
    pendingIntent: MessageListPendingIntent | null
    /** runtime viewport phase。 */
    phase: MessageListViewportPhase
    /** 距离原生底部的像素距离。 */
    distanceToBottom: number
  }
}

/** 直接替换当前 rows 的输入。 */
export type MessageListRowsReplaceInput<Row> = {
  /** 替换后的 row 列表。 */
  rows: Row[]
  /** 明确标记变化的 row key；未传时默认把本次 rows 全部视为 changed。 */
  changedKeys?: string[]
  /** before 侧是否还有更多；未传时沿用当前窗口状态。 */
  hasMoreBefore?: boolean
  /** after 侧是否还有更多；未传时沿用当前窗口状态。 */
  hasMoreAfter?: boolean
  /** 替换后的推荐 anchor；未传时不改写推荐 anchor。 */
  anchor?: MessageListAnchor
  /** 替换后的 anchor 状态；未传时不改写 anchor 状态。 */
  anchorStatus?: MessageListPage<Row>['anchorStatus']
}

/** 围绕目标重置 rows 的输入。 */
export type MessageListRowsResetAroundInput<Row> = MessageListPage<Row> & {
  /** reset-around 目标。 */
  target: MessageListAnchor
  /** 目标对齐方式；未传时默认 center。 */
  align?: MessageListAlign
  /** 目标消息内部的垂直偏移；未传时不使用消息内部偏移，按 align 对齐。 */
  offsetWithinMessage?: number
}

/** 局部 mutate 当前 rows 的输入。 */
export type MessageListRowsMutation<Row> = {
  /** 要 patch/merge 的 row；未传时不 patch row。 */
  patches?: Row[]
  /** 要移除的 row key；未传时不移除 row。 */
  removeKeys?: string[]
  /** 要强制重新测量/渲染的 row key；未传时不主动失效 row。 */
  invalidateKeys?: string[]
  /** mutate 原因，用于日志；未传时不附加原因。 */
  reason?: string
}

/** 重新读取当前用户所见窗口的选项。 */
export type MessageListReloadCurrentOptions = {
  /** 当前只允许结构性刷新；调用方必须显式说明意图。 */
  reason: 'structural'
}

/** reloadCurrent 被判定为过期的原因。 */
export type MessageListReloadCurrentStaleReason =
  | 'superseded'
  | 'navigation-changed'
  | 'topology-changed'
  | 'session-destroyed'

/** reloadCurrent 失败的原因。 */
export type MessageListReloadCurrentFailureReason =
  | 'request-failed'
  | 'anchor-unavailable'
  | 'contract-violation'
  | 'commit-timeout'

type MessageListReloadCurrentResultBase = {
  /** 本次按当前状态选择的请求类型。 */
  requestKind: 'latest' | 'around'
}

/** reloadCurrent 的唯一终态结果。 */
export type MessageListReloadCurrentResult<Row> =
  | MessageListReloadCurrentResultBase & {
      status: 'applied'
      page: MessageListPage<Row>
      resolvedAnchor?: MessageListAnchor
      resolution?: 'exact' | 'fallback'
    }
  | MessageListReloadCurrentResultBase & {
      status: 'stale'
      staleReason: MessageListReloadCurrentStaleReason
    }
  | MessageListReloadCurrentResultBase & {
      status: 'failed'
      failureReason: MessageListReloadCurrentFailureReason
      error?: unknown
    }

/** 乐观消息确认后的身份重映射。 */
export type MessageListIdentityRemap = {
  /** remap 前的消息锚点。 */
  from: MessageListAnchor
  /** remap 后的消息锚点。 */
  to: MessageListAnchor
  /** remap 前的 row key；未传时用 from anchor 匹配旧 row。 */
  previousKey?: string
  /** remap 后的 row key。 */
  nextKey: string
}

/** 本地 tail stage 输入，常用于发送/重试乐观消息。 */
export type MessageListLocalTailStageInput<Row> = {
  /** 要 staged 的本地 row。 */
  rows: Row[]
  /** 可选最新页，用于同时刷新 latest 窗口；未传时只 stage 本地 row。 */
  latest?: MessageListPage<Row>
  /** 本地 tail stage 原因；未传时默认 send。 */
  reason?:
    /** 新发送消息。 */
    | 'send'
    /** 重试发送消息。 */
    | 'retry'
  /** 要从窗口里退役的旧本地 row key；未传时不退役旧本地 row。 */
  retireKeys?: string[]
}

/** tail append 后的滚动决策。 */
export type MessageListTailAppendFollowDecision =
  /** 跟随到底部。 */
  | 'follow'
  /** 保持当前视觉锚点。 */
  | 'preserve'

/** 远端 tail append 策略收到的上下文。 */
export type MessageListRemoteTailAppendContext<Row, Source = unknown> = {
  /** 当前 session id。 */
  sessionId: MessageListSessionId
  /** 当前业务 source。 */
  source: Source
  /** 即将 append 的远端 row。 */
  rows: Row[]
  /** append 原因；未传时不附加原因。 */
  reason?: string
  /** append 后 after 侧是否仍有更多。 */
  hasMoreAfter: boolean
  /** 当前底部锁定状态。 */
  bottomLockState: MessageListBottomLockState
  /** 当前 pending intent。 */
  pendingIntent: MessageListPendingIntent | null
  /** 当前 viewport phase。 */
  viewportPhase: MessageListViewportPhase
  /** 当前距离原生底部的像素距离。 */
  distanceToBottom: number
  /** 页面是否聚焦。 */
  pageFocused: boolean
}

/** 远端 tail append 策略函数。 */
export type MessageListRemoteTailAppendPolicy<Row, Source = unknown> = (
  context: MessageListRemoteTailAppendContext<Row, Source>,
) => MessageListTailAppendFollowDecision | boolean

/** tail append 的 follow 输入。 */
export type MessageListTailAppendFollowInput<Row> =
  /** 明确 follow/preserve。 */
  | MessageListTailAppendFollowDecision
  /** 自动按远端 tail append 策略判断。 */
  | 'auto'
  /** true 等价 follow，false 等价 preserve。 */
  | boolean
  /** 针对本次 append 的自定义策略。 */
  | MessageListRemoteTailAppendPolicy<Row>

/** 远端 tail append 输入。 */
export type MessageListRemoteTailAppendInput<Row> = {
  /** 要 append 的 row。 */
  rows: Row[]
  /** append 原因；未传时不附加原因。 */
  reason?: string
  /** append 后是否 follow-bottom；未传时按 auto 策略处理。 */
  follow?: MessageListTailAppendFollowInput<Row>
}

/** 单个消息列表 session 对外 API。 */
export type MessageListSession<Row = unknown> = {
  /** 当前 session id。 */
  sessionId: MessageListSessionId
  /** 读取当前状态快照。 */
  getState(): MessageListSessionState<Row>
  /** 订阅状态变化。 */
  subscribe(listener: () => void): () => void
  /** 用户命令。 */
  commands: {
    /** 滚动或加载到源最新。 */
    scrollToLatest(): void
    /** 滚动或加载到指定消息；options 未传时 align 默认 center。 */
    scrollToMessage(target: MessageListAnchor, options?: MessageListScrollToMessageOptions): void
    /** 手动加载 before 侧。 */
    loadBefore(): void
    /** 手动加载 after 侧。 */
    loadAfter(): void
    /** 重新加载 latest 窗口。 */
    reloadLatest(): void
    /** 静默重新读取当前用户所见窗口，并在对应 projection transaction settle 后返回。 */
    reloadCurrent(
      options: MessageListReloadCurrentOptions,
    ): Promise<MessageListReloadCurrentResult<Row>>
  }
  /** 直接操作当前 rows。 */
  rows: {
    /** patch 多个 row。 */
    patch(rows: Row[]): void
    /** mutate 当前 rows。 */
    mutate(input: MessageListRowsMutation<Row>): void
    /** 直接替换当前 rows。 */
    replace(input: MessageListRowsReplaceInput<Row>): void
    /** 重置到 latest page。 */
    resetLatest(page: MessageListPage<Row>): void
    /** 围绕目标重置窗口。 */
    resetAround(input: MessageListRowsResetAroundInput<Row>): void
    /** 应用身份重映射。 */
    applyIdentityRemap(remaps: MessageListIdentityRemap[]): void
    /** 清空当前 rows。 */
    clear(): void
  }
  /** tail 追加 API。 */
  tail: {
    /** 本地乐观 tail API。 */
    local: {
      /** stage 本地 row。 */
      stage(input: Row | Row[] | MessageListLocalTailStageInput<Row>): void
      /** patch 本地 row。 */
      patch(rows: Row[]): void
      /** 应用本地 row 身份重映射。 */
      applyIdentityRemap(remaps: MessageListIdentityRemap[]): void
    }
    /** 远端 tail API。 */
    remote: {
      /** append 远端 row。 */
      append(input: Row | Row[] | MessageListRemoteTailAppendInput<Row>): void
    }
  }
}

/** 外部保留 session 的原因。 */
export type MessageListSessionRetainReason =
  /** 当前活跃可见 session。 */
  | 'active-session'
  /** 分屏或多面板中可见的 session。 */
  | 'split-view'
  /** 预取但尚未挂载的 session。 */
  | 'prefetch'

/** registry entry 当前状态。 */
export type MessageListSessionRegistryEntryStatus =
  /** 已被 React 视图挂载。 */
  | 'mounted'
  /** 当前活跃 session。 */
  | 'active'
  /** 未挂载但被 keepAlive 缓存。 */
  | 'cached'

/** registry 中单个 session 的元信息。 */
export type MessageListSessionRegistryEntry = {
  /** session id。 */
  sessionId: MessageListSessionId
  /** 创建时间戳。 */
  createdAt: number
  /** 最近使用时间戳。 */
  lastUsedAt: number
  /** React 视图 retain 计数。 */
  mountedRetainCount: number
  /** 宿主 retain 计数。 */
  hostRetainCount: number
  /** 当前 entry 状态。 */
  status: MessageListSessionRegistryEntryStatus
}

/** MessageList session registry 对外 API。 */
export type MessageListSessionRegistry<Row = unknown, Source = MessageListSessionSource> = {
  /** 获取或创建 session。 */
  getSession(sessionId: MessageListSessionId): MessageListSession<Row>
  /** 判断 session 是否已经存在。 */
  hasSession(sessionId: MessageListSessionId): boolean
  /** 销毁指定 session。 */
  destroySession(sessionId: MessageListSessionId): boolean
  /** 销毁全部 session。 */
  destroyAll(): void
  /** 返回所有已知 session id。 */
  getSessionIds(): MessageListSessionId[]
  /** 返回指定 session 的元信息。 */
  getSessionMeta(sessionId: MessageListSessionId): MessageListSessionRegistryEntry | null
  /** 外部保留 session，返回 release 函数。 */
  retainSession(sessionId: MessageListSessionId, reason: MessageListSessionRetainReason): () => void
  /** 热更新 registry 选项。 */
  updateOptions(options: MessageListSessionRegistryOptionsPatch<Row, Source>): void
  /** 主动执行 keepAlive 清扫。 */
  sweep(): void
}
