import type { CSSProperties, ReactNode } from 'react'
import type {
  MessageListAnchor,
  MessageListOverlayStatus,
  MessageListResolvedAnchor,
  MessageListScrollToMessageOptions,
  MessageListSession,
} from '../core/session-registry/index'

export type EdgeSlotInput = {
  status: 'idle' | 'loading' | 'error' | 'exhausted'
  retry: () => void
}

export type OverlayStatusInput = MessageListOverlayStatus

export type EmptySlotInput = {
  reload: () => void
}

export type ScrollToLatestSlotInput = {
  visible: boolean
  scrollToLatest: () => void
  bottomLockState: 'LOCKED' | 'UNLOCKED'
  hasMoreAfter: boolean
  pendingIntent:
    | 'edge-before'
    | 'edge-after'
    | 'underflow-fill'
    | 'follow-bottom'
    | 'destination'
    | null
  viewportPhase:
    | 'IDLE'
    | 'PROJECTING'
    | 'MEASURING'
    | 'CORRECTING'
    | 'MOTION'
  distanceToBottom: number
  pageFocused: boolean
}

export type MessageListViewportAnchorChangeEvent = {
  type: 'viewportAnchorChanged'
  sessionId: string
  generation: number
  segmentRevision: number
  reason: 'scroll-idle' | 'transaction-settle' | 'detach'
  anchor: MessageListResolvedAnchor | null
  offsetWithinMessage?: number
}

export type MessageListViewportObservationEvent = {
  type: 'viewportObservationChanged'
  sessionId: string
  generation: number
  segmentRevision: number
  reason: 'transaction-settle' | 'scroll-idle' | 'resize' | 'detach'
  scrollSource:
    | 'user'
    | 'momentum'
    | 'programmatic'
    | 'recovery'
    | 'jump'
    | 'followBottom'
    | 'underflowFill'
    | null
  direction: 'up' | 'down' | 'none'
  activity: 'scrolling' | 'settling' | 'resizing' | 'detached'
  anchor: MessageListResolvedAnchor | null
  offsetWithinMessage?: number
  visibleRange: {
    firstKey: string | null
    lastKey: string | null
  }
  visibleItems: Array<{
    key: string
    visibleRatio: number
  }>
  visibleKeys: string[]
}

export type MessageListCommands = {
  scrollToLatest: () => void
  scrollToMessage: (
    target: MessageListAnchor,
    options?: MessageListScrollToMessageOptions,
  ) => void
  loadBefore: () => void
  loadAfter: () => void
  reloadLatest: () => void
}

export type MessageListRenderRowInput<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  row: TMessage
  item: MessageListRenderItem<TMessage, TOptimistic>
}

export type MessageListRenderItem<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  key: string
  rowKind:
    | 'message'
    | 'date-separator'
    | 'system'
    | 'deleted-placeholder'
    | 'permission-fallback'
  identity?: {
    sessionId: string
    stableId: string
    serverId?: string
    localId?: string
    version: number
  }
  renderVersion: number
  message?: TMessage
  optimistic?: TOptimistic
}

export type MessageListProps<TMessage = unknown, TOptimistic = unknown> = {
  session: MessageListSession<TMessage>
  renderRow: (
    input: MessageListRenderRowInput<TMessage, TOptimistic>,
  ) => ReactNode
  getRowRenderVersion?: (
    item: MessageListRenderItem<TMessage, TOptimistic>,
  ) => unknown
  className?: string
  style?: CSSProperties
  renderBeforeStatus?: (input: EdgeSlotInput) => ReactNode
  renderAfterStatus?: (input: EdgeSlotInput) => ReactNode
  renderTopPlaceholder?: () => ReactNode
  renderOverlayStatus?: (input: OverlayStatusInput) => ReactNode
  renderEmpty?: (input: EmptySlotInput) => ReactNode
  renderScrollToLatest?: (input: ScrollToLatestSlotInput) => ReactNode
  onViewportAnchorChange?: (event: MessageListViewportAnchorChangeEvent) => void
  onViewportObservationChange?: (
    event: MessageListViewportObservationEvent,
  ) => void
  scrollbar?: 'native' | 'custom'
}
