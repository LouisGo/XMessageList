/** 消息在同一 session 内的稳定业务身份。 */
export type MessageIdentity = {
  /** 所属会话，跨 session 的相同 stableId 不视为同一条消息。 */
  sessionId: string
  /** 跨 server/local 状态的主匹配键；serverId/localId 只作为同一 session 内的补充身份。 */
  stableId: string
  /** 服务端确认后的消息 id；缺失时可继续用 stableId/localId 匹配。 */
  serverId?: string
  /** 本地乐观消息 id；服务端确认前用于匹配和 retire。 */
  localId?: string
  /** 身份或内容语义版本，数据层更新时递增，用于生成 renderVersion。 */
  version: number
}

/** runtime 用于滚动锚点、跳转目标和 fallback 的消息身份引用。 */
export type MessageIdentityAnchor = {
  /** 锚点所属会话。 */
  sessionId: string
  /** 首选稳定身份。 */
  stableId: string
  /** 可选服务端身份，用于加强匹配。 */
  serverId?: string
  /** 可选本地身份，用于乐观消息匹配。 */
  localId?: string
  /** 目标不可用时回退到的 stableId。 */
  fallbackStableId?: string
  /** 使用 fallbackStableId 的原因。 */
  fallbackReason?:
    /** 原目标消息已删除。 */
    | 'deleted'
    /** 原目标消息当前不可用。 */
    | 'unavailable'
    /** 原目标消息因权限不可访问。 */
    | 'permission'
}

/** 当前投影中 DOM row 的运行时 key，不等同于业务主键。 */
export type MessageRuntimeItemKey = string

/** viewport runtime 消费的单个 row 数据项。 */
export type MessageDataItem<TMessage = unknown, TOptimistic = unknown> = {
  /** 当前投影 DOM row 的运行时 key，可随 identity-remap 改变；不要当业务主键持久化。 */
  key: MessageRuntimeItemKey
  /** row 的渲染类别，用于区分消息、日期、系统提示和 fallback 占位。 */
  rowKind:
    /** 普通消息 row。 */
    | 'message'
    /** 日期分隔 row。 */
    | 'date-separator'
    /** 系统提示 row。 */
    | 'system'
    /** 已删除消息的占位 row。 */
    | 'deleted-placeholder'
    /** 权限不可访问消息的占位 row。 */
    | 'permission-fallback'
  /** row 关联的业务身份；非消息类 row 可为空。 */
  identity?: MessageIdentity
  /** row 渲染版本；变化表示 adapter 需要重新测量该 row。 */
  renderVersion: number
  /** 业务消息载荷，由调用方类型参数定义。 */
  message?: TMessage
  /** 乐观消息载荷，由调用方类型参数定义。 */
  optimistic?: TOptimistic
}
