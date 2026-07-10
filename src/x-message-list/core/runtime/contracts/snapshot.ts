import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageRuntimeItemKey,
} from './identity'
import type {
  LoadedSegmentContext,
  SegmentProjectionEffect,
  SegmentModifier,
} from './segment'

/** React projection commit 的唯一 token，adapter ack 时必须原样回传。 */
export type ProjectionCommitToken = {
  /** 当前投影所属 session。 */
  sessionId: string
  /** 当前数据窗口 generation。 */
  generation: number
  /** 当前数据窗口修订号。 */
  segmentRevision: number
  /** 每次需要 React 重新 ack 的投影都会递增。 */
  projectionRevision: number
}

/** before/after 边缘加载状态。 */
export type EdgeSnapshotState = {
  /** edge 当前状态。 */
  status:
    /** 空闲，可发起新的 edge need。 */
    | 'idle'
    /** 已发出 edge need，等待数据层返回。 */
    | 'loading'
    /** 当前 edge 请求失败，可由调用方 retry。 */
    | 'error'
    /** 数据源确认该侧没有更多数据。 */
    | 'exhausted'
  /** 当前加载锁存 token，用于区分同一 edge 的加载轮次。 */
  latchToken?: string
  /** 当前数据请求 token，对应 needMoreBefore/needMoreAfter 事件。 */
  requestToken?: string
}

/** viewport 是否锁定到数据源底部。 */
export type BottomLockState =
  /** 已锁定到源底部，新 latest/append 可继续跟随到底。 */
  | 'LOCKED'
  /** 未锁定到底部，普通更新应优先保持当前视觉锚点。 */
  | 'UNLOCKED'

/** runtime 当前等待完成的用户/系统意图。 */
export type PendingIntent =
  /** before 侧 edge 请求正在等待数据。 */
  | 'edge-before'
  /** after 侧 edge 请求正在等待数据。 */
  | 'edge-after'
  /** runtime 正在补齐短窗口。 */
  | 'underflow-fill'
  /** follow-bottom/latest 请求正在等待源底部数据。 */
  | 'follow-bottom'
  /** jump/restore destination 请求正在等待 around 数据或 DOM settle。 */
  | 'destination'

/** runtime projection 到 DOM settle 的阶段。 */
export type ViewportPhase =
  /** 没有正在进行的 projection、测量、修正或 motion。 */
  | 'IDLE'
  /** 已发布新 snapshot，等待 React projection commit ack。 */
  | 'PROJECTING'
  /** React 已 ack，runtime 正在读取 DOM metrics。 */
  | 'MEASURING'
  /** runtime 正在按锚点或目标修正 scrollTop。 */
  | 'CORRECTING'
  /** runtime 正在执行 JS bounded scroll motion。 */
  | 'MOTION'

/** 短 segment 在可视区域内的对齐方式。 */
export type ShortSegmentAlignment =
  /** 短窗口贴近视口顶部。 */
  | 'start'
  /** 短窗口居中显示。 */
  | 'center'
  /** 短窗口贴近视口底部。 */
  | 'end'

/** React adapter 订阅的 viewport runtime 快照。 */
export type MessageListSnapshot<TMessage = unknown, TOptimistic = unknown> = {
  /** 当前 session。 */
  sessionId: string
  /** 当前数据窗口 generation。 */
  generation: number
  /** 当前数据窗口修订号。 */
  segmentRevision: number
  /** 每次需要 React 重新 ack 的投影都会递增；adapter 必须按 commitToken 回传。 */
  projectionRevision: number
  /** 当前投影的 commit token。 */
  commitToken: ProjectionCommitToken
  /** 当前要由 React 渲染的 row 列表。 */
  items: MessageDataItem<TMessage, TOptimistic>[]
  /** 当前 loaded segment 的元信息。 */
  segmentMeta: {
    /** before 侧是否还有可请求数据。 */
    hasMoreBefore: boolean
    /** after 侧是否还有可请求数据。 */
    hasMoreAfter: boolean
    /** 当前 loaded rows 的语义上下文。 */
    context: LoadedSegmentContext
    /** 生成该快照的 segment 变更类型。 */
    modifier: SegmentModifier
    /** 与主 modifier 原子结算的附带效果。 */
    effects?: SegmentProjectionEffect[]
    /** 数据层提供的推荐锚点。 */
    anchor?: MessageIdentityAnchor
    /** 推荐锚点的可用性状态。 */
    anchorStatus?:
      /** anchor 正常可用。 */
      | 'normal'
      /** anchor 对应消息已删除。 */
      | 'deleted'
      /** anchor 当前不可用。 */
      | 'unavailable'
      /** anchor 因权限不可访问。 */
      | 'permission'
    /** 短 segment 在视口内的对齐方式。 */
    shortSegmentAlignment: ShortSegmentAlignment
    /** underflow 补齐状态。 */
    underflow:
      /** 尚未评估当前窗口是否需要 underflow fill。 */
      | 'unknown'
      /** 当前窗口过短，runtime 已尝试或正在尝试补齐。 */
      | 'fillable'
      /** 当前窗口无需继续 underflow fill。 */
      | 'settled'
  }
  /** before/after edge 的加载状态。 */
  edgeState: {
    /** before 侧加载状态。 */
    before: EdgeSnapshotState
    /** after 侧加载状态。 */
    after: EdgeSnapshotState
  }
  /** viewport 是否锁定到源底部。 */
  bottomLockState: BottomLockState
  /** runtime 正等待 host 数据或 DOM/motion settle 的意图；空值才允许新的普通 edge need。 */
  pendingIntent: PendingIntent | null
  /** 当前提交流水线阶段，不等同于数据加载状态。 */
  viewportPhase: ViewportPhase
}

/** 调试和 E2E 读取的 viewport 证据快照。 */
export type ViewportEvidence = {
  /** 当前 session。 */
  sessionId: string
  /** 当前数据窗口 generation。 */
  generation: number
  /** 当前数据窗口修订号。 */
  segmentRevision: number
  /** 当前 projection 修订号。 */
  projectionRevision: number
  /** 正在等待 ack 的 token；没有 pending 时为当前 snapshot commitToken。 */
  commitToken: ProjectionCommitToken | null
  /** 当前 segment modifier 类型。 */
  modifier: SegmentModifier['type']
  /** 与主 modifier 同一 transaction 结算的附带效果。 */
  effects?: SegmentProjectionEffect[]
  /** before 侧是否还有可请求数据。 */
  hasMoreBefore: boolean
  /** after 侧是否还有可请求数据。 */
  hasMoreAfter: boolean
  /** 当前 loaded rows 的语义上下文。 */
  context: LoadedSegmentContext
  /** 当前底部锁定状态。 */
  bottomLockState: BottomLockState
  /** 当前 pending intent。 */
  pendingIntent: PendingIntent | null
  /** 短 segment 对齐方式。 */
  shortSegmentAlignment: ShortSegmentAlignment
  /** 当前 scrollTop。 */
  scrollTop: number
  /** 当前视口高度。 */
  clientHeight: number
  /** 当前原生 scrollHeight。 */
  scrollHeight: number
  /** 本次测量得到的可见 row 信息。 */
  visibleRows: Array<{
    /** row 运行时 key。 */
    key: MessageRuntimeItemKey
    /** row 对应 stableId。 */
    stableId?: string
    /** row 对应 serverId。 */
    serverId?: string
    /** row 类型。 */
    rowKind: string
    /** row DOM rect top。 */
    top: number
    /** row DOM rect bottom。 */
    bottom: number
  }>
  /** before edge trigger 的 DOM rect。 */
  beforeTrigger: DOMRectLike
  /** after edge trigger 的 DOM rect。 */
  afterTrigger: DOMRectLike
  /** 底部 marker 的 DOM rect；未注册时为 null。 */
  bottomMarker: DOMRectLike | null
  /** 当前 viewport phase。 */
  phase: ViewportPhase
  /** before/after edge 状态。 */
  edgeState: MessageListSnapshot['edgeState']
}

/** DOMRect 的可序列化子集。 */
export type DOMRectLike = {
  /** 上边界坐标。 */
  top: number
  /** 下边界坐标。 */
  bottom: number
  /** 左边界坐标。 */
  left: number
  /** 右边界坐标。 */
  right: number
  /** 宽度。 */
  width: number
  /** 高度。 */
  height: number
}

/** snapshot 订阅回调；调用方需再通过 getSnapshot 读取最新值。 */
export type MessageListSnapshotListener = () => void
