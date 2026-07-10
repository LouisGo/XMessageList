import type { MessageListRemoteTailAppendPolicy } from './session'

/** 会话 id，通常对应一个会话、频道或消息源窗口。 */
export type MessageListSessionId = string
/** 默认 session source 类型；高级场景可用 Source 泛型替换为业务源对象。 */
export type MessageListSessionSource = MessageListSessionId
/** session 缓存保留强度。 */
export type MessageListSegmentRetention =
  /** 低保留，适合大量低频会话。 */
  | 'low'
  /** 平衡保留，默认策略。 */
  | 'balanced'
  /** 高保留，适合频繁切换或关键会话。 */
  | 'high'
/** 当前 loaded rows 的语义上下文。 */
export type MessageListLoadedContext =
  /** 当前窗口代表源最新消息区间。 */
  | 'latest'
  /** 当前窗口代表被恢复的非最新历史阅读区间。 */
  | 'history'
  /** 当前窗口代表围绕用户目标构建的跳转区间。 */
  | 'around'
/** 数据请求的语义触发来源。 */
export type MessageListRequestTrigger =
  /** 真实 mounted viewport 的 before/after edge need。 */
  | 'viewport'
  /** 用户或宿主命令触发。 */
  | 'command'
  /** anchor memory restore 触发。 */
  | 'restore'
  /** bootstrap、underflow 或内部恢复触发。 */
  | 'internal'
/** 锚点不可用时的 fallback 原因。 */
export type AnchorFallbackReason =
  /** 目标消息已删除。 */
  | 'deleted'
  /** 目标消息当前不可用。 */
  | 'unavailable'
  /** 目标消息因权限不可访问。 */
  | 'permission'
/** 页面返回 anchor 的可用性。 */
export type AnchorStatus =
  /** anchor 正常可用。 */
  | 'normal'
  /** anchor 对应消息已删除。 */
  | 'deleted'
  /** anchor 当前不可用。 */
  | 'unavailable'
  /** anchor 因权限不可访问。 */
  | 'permission'
/** 消息在视口中的对齐方式。 */
export type MessageListAlign =
  /** 目标顶部对齐视口顶部。 */
  | 'start'
  /** 目标居中对齐视口。 */
  | 'center'
  /** 目标底部对齐视口底部。 */
  | 'end'
  /** 已完整可见则不滚动，否则选择移动距离较小的一侧对齐。 */
  | 'nearest'
/** before/after edge 加载状态。 */
export type MessageListEdgeStatus =
  /** 空闲，可发起请求。 */
  | 'idle'
  /** 已发起请求，等待返回。 */
  | 'loading'
  /** 请求失败，可 retry。 */
  | 'error'
  /** 数据源确认该侧没有更多数据。 */
  | 'exhausted'
/** 当前 viewport 是否锁定源底部。 */
export type MessageListBottomLockState =
  /** 已锁定到底部，新 latest/append 可继续跟随。 */
  | 'LOCKED'
  /** 未锁定到底部，更新应保持当前视觉锚点。 */
  | 'UNLOCKED'
/** runtime 当前等待完成的意图。 */
export type MessageListPendingIntent =
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
/** viewport projection 到 DOM settle 的阶段。 */
export type MessageListViewportPhase =
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
/** 外部可传入的消息锚点。 */
export type MessageListAnchor = {
  /** 兼容业务已有 id；未提供 stableId/serverId/localId 时可作为 stableId 来源。 */
  id?: string
  /** 锚点所属 session；缺省时使用当前 session。 */
  sessionId?: string
  /** 稳定消息 id；未传时依次使用 serverId、localId、id。 */
  stableId?: string
  /** 服务端消息 id；未传时不写入服务端身份，除非 id 被兼容映射。 */
  serverId?: string
  /** 本地乐观消息 id；未传时不写入本地身份。 */
  localId?: string
  /** 目标不可用时回退到的 stableId；未传时不做 fallback 跳转。 */
  fallbackStableId?: string
  /** 使用 fallbackStableId 的原因；未传时不附加 fallback 原因。 */
  fallbackReason?: AnchorFallbackReason
}

/** 已补齐 sessionId/stableId 的标准锚点。 */
export type MessageListResolvedAnchor = {
  /** 原始业务 id。 */
  id?: string
  /** 锚点所属 session。 */
  sessionId: string
  /** 稳定消息 id。 */
  stableId: string
  /** 服务端消息 id。 */
  serverId?: string
  /** 本地乐观消息 id。 */
  localId?: string
  /** 目标不可用时回退到的 stableId。 */
  fallbackStableId?: string
  /** 使用 fallbackStableId 的原因。 */
  fallbackReason?: AnchorFallbackReason
}

/** 数据请求返回的一页消息。 */
export type MessageListPage<Row> = {
  /** 页面 row，按展示顺序排列。 */
  rows: Row[]
  /** before 侧是否还有更多数据。 */
  hasMoreBefore: boolean
  /** after 侧是否还有更多数据。 */
  hasMoreAfter: boolean
  /** after page 证明已抵达最新区间。 */
  reachedLatest?: boolean
  /** 页面推荐锚点；未传时 runtime 使用当前可见锚点或数据窗口推导。 */
  anchor?: MessageListAnchor
  /** 页面推荐锚点可用性；未传时不提供可用性状态，runtime 仅在异常状态存在时启用 fallback 语义。 */
  anchorStatus?: AnchorStatus
  /** 可选总数；未传时没有总数信息，仅作为宿主状态，不参与 runtime 滚动语义。 */
  total?: number
}

/** 会话首次进入时的一次性初始化窗口。 */
export type MessageListInitialWindow<Row> =
  | {
      /** 当前初始化结果就是源最新消息区间。 */
      context: 'latest'
      /** latest page 必须满足 hasMoreAfter=false。 */
      page: MessageListPage<Row>
    }
  | {
      /** 当前初始化结果是宿主恢复出的历史阅读窗口。 */
      context: 'history'
      /** 历史窗口可以同时拥有 before/after 数据。 */
      page: MessageListPage<Row>
      /** 恢复锚点和该消息相对视口基准的像素偏移。 */
      restore: MessageListAnchorMemoryValue
    }

/** 需要跨 session/卸载保存的视口锚点记忆。 */
export type MessageListAnchorMemoryValue = {
  /** 保存的消息锚点。 */
  anchor: MessageListAnchor
  /** 锚点消息内部的垂直偏移；未传时不使用消息内部偏移，按目标对齐规则处理。 */
  offsetWithinMessage?: number
}

/** scrollToMessage 命令选项。 */
export type MessageListScrollToMessageOptions = {
  /** 宿主传入的滚动行为提示；未传时不附加行为提示，runtime 当前不直接使用原生 smooth。 */
  behavior?: ScrollBehavior
  /** 目标消息对齐方式；未传时默认 center。 */
  align?: MessageListAlign
  /** motion 方向和跨 session 提示；未传时不附加 motion 提示，不改变请求语义。 */
  motion?: {
    /** 触发跳转的来源锚点；未传时不提供来源锚点。 */
    origin?: MessageListAnchor
    /** 调用方已知的目标方向；未传时 runtime 从当前/目标位置推导。 */
    direction?:
      /** 目标在 before 侧。 */
      | 'before'
      /** 目标在 after 侧。 */
      | 'after'
      /** 无方向约束。 */
      | 'none'
    /** 是否跨 session；未传时按 false 处理。 */
    crossSession?: boolean
  }
}

/** 数据请求回调收到的上下文。 */
export type MessageListRequestContext<Row, Source = MessageListSessionSource> = {
  /** 当前 session id。 */
  sessionId: MessageListSessionId
  /** 当前 session 对应业务源。 */
  source: Source
  /** 本次请求建议页大小。 */
  pageSize: number
  /** runtime 请求 token；返回结果通过该 token 判 stale。 */
  requestToken?: string
  /** 本次请求的结构化触发来源。 */
  trigger: MessageListRequestTrigger
  /** 请求原因。 */
  reason?: string
  /** 可选取消信号；session 销毁、请求被新 reload 取代或用户导航时会触发 abort。 */
  signal?: AbortSignal
  /** around 请求目标。 */
  target?: MessageListResolvedAnchor
  /** before/after 请求的边界 row。 */
  boundaryRow?: Row
}

/** session 级宿主上下文。 */
export type MessageListSessionContext<Source = MessageListSessionSource> = {
  /** 当前 session id。 */
  sessionId: MessageListSessionId
  /** 当前 session 对应业务源。 */
  source: Source
}

/** 宿主必须提供的数据适配器。 */
export type MessageListAdapter<Row, Source = MessageListSessionSource> = {
  /** row 身份和分类适配。 */
  row: {
    /** 返回 row 在当前窗口中的运行时 key。 */
    getKey(row: Row): string
    /** 返回 row 对应消息锚点；非消息 row 可返回 null。 */
    getAnchor(row: Row): MessageListAnchor | null
    /** 返回 row 版本；未提供或返回非数字时 renderVersion 归一为 0。 */
    getVersion?(row: Row): unknown
    /** 返回 row 类型；未提供或返回未知类型时按普通 message 处理。 */
    getKind?(row: Row): string
  }
  /** 数据请求入口。 */
  request: {
    /**
     * 原子加载首次进入窗口。提供后由宿主完整判定 latest/history，
     * 并优先于 anchorMemory.load；未提供时沿用原 bootstrap 协议。
     */
    loadInitial?(context: MessageListRequestContext<Row, Source>): Promise<MessageListInitialWindow<Row>>
    /** 加载最新窗口。 */
    loadLatest(context: MessageListRequestContext<Row, Source>): Promise<MessageListPage<Row>>
    /** 向 before 侧加载更多。 */
    loadBefore(context: MessageListRequestContext<Row, Source>): Promise<MessageListPage<Row>>
    /** 向 after 侧加载更多。 */
    loadAfter(context: MessageListRequestContext<Row, Source>): Promise<MessageListPage<Row>>
    /** 围绕指定 target 加载窗口。 */
    loadAround(context: MessageListRequestContext<Row, Source>): Promise<MessageListPage<Row>>
  }
  /** 跨卸载保存/恢复 viewport anchor；未提供时不做跨卸载锚点记忆。 */
  anchorMemory?: {
    /** 读取当前 session 保存的 anchor。 */
    load(context: MessageListSessionContext<Source>): MessageListAnchorMemoryValue | null | Promise<MessageListAnchorMemoryValue | null>
    /** 保存当前 session 的 anchor。 */
    save(context: MessageListSessionContext<Source>, value: MessageListAnchorMemoryValue): void | Promise<void>
  }
  /** 已读回执配置；未提供时不会自动标记已读。 */
  readReceipts?: {
    /** 批量 markRead 前的延迟；未传时默认 100ms。 */
    batchDelayMs?: number
    /** 返回该 row 是否需要标记已读；未传时所有可见且未发送过的 row 都会入队。 */
    shouldMarkRead?(row: Row): boolean
    /** 执行批量已读标记。 */
    markRead(rows: Row[]): void | Promise<void>
    /** markRead 出错回调；当前失败批次不会自动重试。 */
    onError?(error: unknown): void
  }
}

/** runtime 滚动动画开关配置。 */
export type MessageListScrollMotionConfig = {
  /** 是否启用 runtime JS motion；未传时默认 true，函数形式每次启动 motion 时求值。 */
  enabled?: boolean | (() => boolean)
}

/** 远端尾部 append 策略配置。 */
export type MessageListRemoteTailAppendConfig<Row, Source = unknown> = {
  /** 返回页面是否聚焦；未提供时默认 document.hasFocus?.() ?? true。 */
  getPageFocus?: () => boolean
  /** 决定远端 append 是否 follow-bottom；未传时使用内置 tail 语义。 */
  shouldFollowRemoteAppend?: MessageListRemoteTailAppendPolicy<Row, Source>
}

/** 创建 session registry 的完整配置。 */
export type MessageListSessionRegistryOptions<Row, Source = MessageListSessionSource> = {
  /** 默认分页、保留和 keepAlive 配置；未传时使用 pageSize 32、retention balanced、keepAlive 20/600000ms。 */
  defaults?: {
    /** 默认页大小；未传时仓库默认 32。 */
    pageSize?: number
    /** session segment 保留强度；未传时默认 balanced。 */
    retention?: MessageListSegmentRetention
    /** 未挂载 session 的缓存配置；未传时默认 maxSessions 20、ttlMs 600000。 */
    keepAlive?: {
      /** 最多缓存 session 数；未传时默认 20。 */
      maxSessions?: number
      /** 缓存 session 空闲存活时间；未传时默认 600000ms。 */
      ttlMs?: number
    }
  }
  /** 远端 tail append 策略；未传时使用内置 tail 语义和页面聚焦默认值。 */
  tailEvents?: MessageListRemoteTailAppendConfig<Row, Source>
  /** runtime scroll motion 配置；未传时 motion enabled 默认为 true。 */
  scrollMotion?: MessageListScrollMotionConfig
  /** 根据 sessionId 解析业务 source；未传时把 sessionId 作为 Source 使用。 */
  getSessionSource?: (sessionId: MessageListSessionId) => Source
  /** 根据 source 获取适配器。 */
  getAdapter: (source: Source) => MessageListAdapter<Row, Source>
  /** 数据请求完成回调；未传时不通知宿主。 */
  onRequestResult?: (result: MessageListRequestResult<Row, Source>) => void
  /** runtime 事件日志回调；未传时不通知宿主。 */
  onRuntimeEvent?: (event: MessageListRuntimeLogEvent) => void
}

/** updateOptions 接受的局部配置补丁。 */
export type MessageListSessionRegistryOptionsPatch<Row, Source = MessageListSessionSource> = {
  /** 可热更新的默认配置；未传字段沿用当前 registry 配置。 */
  defaults?: {
    /** 默认页大小；未传时沿用当前值，初始默认 32。 */
    pageSize?: number
    /** keepAlive 缓存配置；未传字段沿用当前值，初始默认 maxSessions 20、ttlMs 600000。 */
    keepAlive?: {
      /** 最多缓存 session 数；未传时沿用当前值，初始默认 20。 */
      maxSessions?: number
      /** 缓存 session 空闲存活时间；未传时沿用当前值，初始默认 600000ms。 */
      ttlMs?: number
    }
  }
  /** 远端 tail append 策略；未传时沿用当前配置。 */
  tailEvents?: MessageListRemoteTailAppendConfig<Row, Source>
  /** runtime scroll motion 配置；未传时沿用当前配置。 */
  scrollMotion?: MessageListScrollMotionConfig
  /** 数据请求完成回调；未传时沿用当前配置。 */
  onRequestResult?: (result: MessageListRequestResult<Row, Source>) => void
  /** runtime 事件日志回调；未传时沿用当前配置。 */
  onRuntimeEvent?: (event: MessageListRuntimeLogEvent) => void
}

/** 数据请求完成结果。 */
export type MessageListRequestResult<Row, Source> = {
  /** 当前 session id。 */
  sessionId: MessageListSessionId
  /** 当前业务 source。 */
  source: Source
  /** 请求类型。 */
  kind:
    /** 会话首次进入的原子初始化窗口。 */
    | 'initial'
    /** 加载最新窗口。 */
    | 'latest'
    /** 加载 before 侧。 */
    | 'before'
    /** 加载 after 侧。 */
    | 'after'
    /** 围绕目标加载。 */
    | 'around'
  /** 请求结果状态。 */
  status:
    /** 请求结果已应用到当前 segment。 */
    | 'applied'
    /** 请求失败。 */
    | 'failed'
    /** 请求结果已过期，被丢弃。 */
    | 'stale'
  /** 本次请求的结构化触发来源。 */
  trigger: MessageListRequestTrigger
  /** 成功返回的页面。 */
  page?: MessageListPage<Row>
  /** 失败时的错误对象。 */
  error?: unknown
}

/** runtime 诊断日志记录。 */
export type MessageListRuntimeLogDiagnosticRecord = {
  /** 诊断名称。 */
  name: string
  /** 诊断严重级别。 */
  severity:
    /** 调试采样。 */
    | 'debug'
    /** 重要但预期内状态。 */
    | 'info'
    /** 可恢复异常路径。 */
    | 'warn'
    /** runtime 错误。 */
    | 'error'
  /** 诊断时间戳。 */
  timestamp: number
  /** 诊断详情。 */
  details: Record<string, unknown>
}

/** 向宿主暴露的 runtime 日志事件。 */
export type MessageListRuntimeLogEvent = {
  /** 原始 runtime event 类型。 */
  type: string
  /** 当前 session id。 */
  sessionId?: MessageListSessionId
  /** 当前 generation。 */
  generation?: number
  /** 当前 segment revision。 */
  segmentRevision?: number
  /** 相关请求 token。 */
  requestToken?: string
  /** 触发原因。 */
  reason?: string
  /** 相关 edge。 */
  edge?:
    /** before 侧。 */
    | 'before'
    /** after 侧。 */
    | 'after'
  /** 相关目标。 */
  target?: MessageListAnchor
  /** 相关 anchor。 */
  anchor?: MessageListAnchor | null
  /** 诊断载荷。 */
  diagnostic?: MessageListRuntimeLogDiagnosticRecord
  /** 额外事件详情。 */
  details?: Record<string, unknown>
}

/** 覆盖层状态，通常用于首次加载、错误遮罩或全局 pending。 */
export type MessageListOverlayStatus = {
  /** 覆盖层状态。 */
  status:
    /** 无覆盖层状态。 */
    | 'idle'
    /** 正在加载。 */
    | 'loading'
    /** 加载失败。 */
    | 'error'
  /** 重试当前 overlay 对应请求。 */
  retry: () => void
  /** 错误对象。 */
  error?: unknown
}

/** React 层可订阅的 view 状态。 */
export type MessageListViewState = {
  /** 当前 overlay 状态。 */
  overlayStatus: MessageListOverlayStatus
}
