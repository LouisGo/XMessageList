import type { CSSProperties, ReactNode } from 'react'
import type {
  MessageListController,
  MessageListOverlayStatus,
} from '../manager/index'
import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageListRuntime,
  MessageListScrollToMessageOptions,
  MessageListSnapshot,
  ViewportAnchorChangedEvent,
  ViewportObservationChangedEvent,
} from '../runtime/index'

export type EdgeSlotInput = {
  status: 'idle' | 'loading' | 'error' | 'exhausted'
  retry: () => void
}

export type OverlayStatusInput = MessageListOverlayStatus & {
  snapshot: MessageListSnapshot
  observation: ViewportObservationChangedEvent | null
}

export type EmptySlotInput = {
  reload: () => void
}

export type ScrollToLatestSlotInput = {
  visible: boolean
  scrollToLatest: () => void
}

export type MessageListOverlayInput = {
  snapshot: MessageListSnapshot
  observation: ViewportObservationChangedEvent | null
  commands: MessageListCommands
}

export type MessageListCommands = {
  scrollToLatest: () => void
  scrollToMessage: (
    target: MessageIdentityAnchor,
    options?: MessageListScrollToMessageOptions,
  ) => void
}

export type MessageListRenderRowInput<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  row: TMessage
  item: MessageDataItem<TMessage, TOptimistic>
}

export type MessageListProps<TMessage = unknown, TOptimistic = unknown> = {
  controller?: MessageListController<TMessage>
  runtime?: MessageListRuntime<TMessage, TOptimistic>
  renderRow: (
    input: MessageListRenderRowInput<TMessage, TOptimistic>,
  ) => ReactNode
  getRowRenderVersion?: (
    item: MessageDataItem<TMessage, TOptimistic>,
  ) => unknown
  className?: string
  style?: CSSProperties
  renderBeforeStatus?: (input: EdgeSlotInput) => ReactNode
  renderAfterStatus?: (input: EdgeSlotInput) => ReactNode
  renderTopPlaceholder?: () => ReactNode
  renderOverlayStatus?: (input: OverlayStatusInput) => ReactNode
  renderEmpty?: (input: EmptySlotInput) => ReactNode
  renderScrollToLatest?: (input: ScrollToLatestSlotInput) => ReactNode
  /** @deprecated use renderBeforeStatus */
  renderBeforeEdge?: (input: EdgeSlotInput) => ReactNode
  /** @deprecated use renderAfterStatus */
  renderAfterEdge?: (input: EdgeSlotInput) => ReactNode
  /** @deprecated use renderOverlayStatus */
  renderOverlay?: (input: MessageListOverlayInput) => ReactNode
  onViewportAnchorChange?: (event: ViewportAnchorChangedEvent) => void
  onViewportObservationChange?: (event: ViewportObservationChangedEvent) => void
  scrollbar?: 'native' | 'custom'
}
