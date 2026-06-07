import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from './identity'

/** reset-around 后目标消息的视口对齐方式。 */
export type ResetAroundAlign =
  /** 目标顶部对齐视口顶部。 */
  | 'start'
  /** 目标居中对齐视口。 */
  | 'center'
  /** 目标底部对齐视口底部。 */
  | 'end'
  /** 若目标已完整可见则不滚动，否则选择移动距离较小的一侧对齐。 */
  | 'nearest'

/** 当前 loaded rows 的语义上下文。 */
export type LoadedSegmentContext =
  /** 当前窗口代表源最新消息区间。 */
  | 'latest'
  /** 当前窗口代表被恢复的非最新历史阅读区间。 */
  | 'history'
  /** 当前窗口代表围绕用户目标构建的跳转区间。 */
  | 'around'

/** 描述 LoadedSegment 相对上一投影的变更类型，runtime 依此选择测量、修正和滚动结算策略。 */
export type SegmentModifier =
  /** 初始加载或完整重建 segment。 */
  | { type: 'bootstrap' }
  /** 在 before 侧扩展历史数据。 */
  | {
      type: 'extend-before'
      /** 对应 needMoreBefore 事件中的 requestToken。 */
      requestToken: string
    }
  /** 在 after 侧扩展后续数据。 */
  | {
      type: 'extend-after'
      /** 对应 needMoreAfter 事件中的 requestToken。 */
      requestToken: string
    }
  /** 围绕指定目标重置窗口，常用于 jump/restore。 */
  | {
      type: 'reset-around'
      /** reset-around 的目标消息身份。 */
      target: MessageIdentityAnchor
      /** 目标消息在视口中的对齐方式。 */
      align?: ResetAroundAlign
      /** 目标消息内部的垂直偏移，用于 restore。 */
      offsetWithinMessage?: number
    }
  /** 重置到源最新窗口，常用于 follow-bottom/latest。 */
  | { type: 'reset-latest' }
  /** 裁掉 before 侧数据窗口。 */
  | {
      type: 'trim-before'
      /** 本次 trim 的标识，用于诊断和防重复。 */
      trimToken: string
    }
  /** 裁掉 after 侧数据窗口。 */
  | {
      type: 'trim-after'
      /** 本次 trim 的标识，用于诊断和防重复。 */
      trimToken: string
    }
  /** 局部更新现有 row，不改变窗口语义。 */
  | {
      type: 'patch'
      /** 本次 patch 影响的 row key。 */
      changedKeys: MessageRuntimeItemKey[]
    }
  /** 在尾部追加新 row，可选择保持锚点或跟随到底部。 */
  | {
      type: 'append'
      /** 本次 append 新增或更新的 row key。 */
      changedKeys: MessageRuntimeItemKey[]
      /** append 后的滚动语义。 */
      follow:
        /** 保持源底部跟随，通常用于自己发送消息或最新端 live append。 */
        | 'follow'
        /** 保持旧视觉锚点，不强制滚到底部。 */
        | 'preserve'
      /** append 时需要从当前窗口移除的乐观/失败 row key。 */
      retireKeys?: MessageRuntimeItemKey[]
    }
  /** 把乐观 row 身份重映射到确认 row 身份。 */
  | {
      type: 'identity-remap'
      /** 本次身份重映射列表。 */
      remaps: Array<{
        /** remap 前的消息身份。 */
        from: MessageIdentityAnchor
        /** remap 后的消息身份。 */
        to: MessageIdentityAnchor
        /** remap 前的 row key；缺失时仍可按 from identity 匹配 row，但不能迁移旧 key 的测量缓存。 */
        previousKey?: MessageRuntimeItemKey
        /** remap 后的 row key。 */
        nextKey: MessageRuntimeItemKey
      }>
    }

/** data runtime 已经去重、排序并生成的不可变 segment；viewport runtime 只能消费它做投影和滚动结算。 */
export type LoadedSegment<TMessage = unknown, TOptimistic = unknown> = {
  /** segment 所属 session。 */
  sessionId: string
  /** 数据窗口 generation；跨 generation 的旧 segment 会被 runtime 视为 stale。 */
  generation: number
  /** 同一 generation 内的递增修订号。 */
  segmentRevision: number
  /** 当前窗口内按展示顺序排列的 row 数据。 */
  items: MessageDataItem<TMessage, TOptimistic>[]
  /** before 侧是否还有可请求数据。 */
  hasMoreBefore: boolean
  /** after 侧是否还有可请求数据。 */
  hasMoreAfter: boolean
  /** 当前 loaded rows 的语义上下文。 */
  context: LoadedSegmentContext
  /** 数据层提供的推荐锚点；runtime 可能在 DOM 中解析为当前 viewport anchor。 */
  anchor?: MessageIdentityAnchor
  /** anchor 的可用性状态，用于 jump/restore fallback 事件。 */
  anchorStatus?:
    /** anchor 正常可用。 */
    | 'normal'
    /** anchor 对应消息已删除。 */
    | 'deleted'
    /** anchor 当前不可用。 */
    | 'unavailable'
    /** anchor 因权限不可访问。 */
    | 'permission'
  /** 描述本次 segment 变更类型。 */
  modifier: SegmentModifier
}
