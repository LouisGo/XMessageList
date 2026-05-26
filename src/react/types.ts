import type { CSSProperties, ReactNode } from 'react'
import type {
  MessageDataItem,
  MessageListRuntime,
  MessageListSnapshot,
} from '../runtime'

export type EdgeSlotInput = {
  status: 'idle' | 'loading' | 'error' | 'exhausted'
  retry: () => void
}

export type ScrollToLatestSlotInput = {
  visible: boolean
  scrollToLatest: () => void
}

export type MessageListOverlayInput = {
  snapshot: MessageListSnapshot
}

export type MessageListCommands = {
  scrollToLatest: () => void
}

export type MessageListProps<TMessage = unknown, TOptimistic = unknown> = {
  runtime: MessageListRuntime<TMessage, TOptimistic>
  renderRow: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  getRowRenderVersion?: (
    item: MessageDataItem<TMessage, TOptimistic>,
  ) => unknown
  className?: string
  style?: CSSProperties
  renderBeforeEdge?: (input: EdgeSlotInput) => ReactNode
  renderAfterEdge?: (input: EdgeSlotInput) => ReactNode
  renderScrollToLatest?: (input: ScrollToLatestSlotInput) => ReactNode
  renderOverlay?: (input: MessageListOverlayInput) => ReactNode
  onViewportAnchorChange?: () => void
  onViewportObservationChange?: () => void
  scrollbar?: 'native' | 'custom'
}
