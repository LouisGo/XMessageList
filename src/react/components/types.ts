import type { CSSProperties, ReactNode } from 'react'
import type {
  MessageDataItem,
  MessageIdentityAnchor,
  MessageViewportRuntime,
  MessageViewportSnapshot,
  ViewportAnchorChangedEvent,
  ViewportObservationChangedEvent,
} from '../../runtime'

export type MessageViewportCommands = {
  followBottom: () => void
  jump: (
    target: MessageIdentityAnchor,
    origin?: MessageIdentityAnchor,
  ) => void
}

export type MessageViewportProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderMessage: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  /**
   * Optional explicit invalidation for row output that depends on external
   * UI state outside the MessageDataItem. When provided, row memoization uses
   * this value instead of renderMessage function identity.
   */
  getRowRenderVersion?: (
    item: MessageDataItem<TMessage, TOptimistic>,
  ) => unknown
  className?: string
  aiRegion?: string
  enableAiDomAttributes?: boolean
  style?: CSSProperties
  renderTopEdge?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
  renderBottomEdge?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
  renderFollowBottom?: (input: {
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
    followBottom: () => void
  }) => ReactNode
  onViewportAnchorChanged?: (event: ViewportAnchorChangedEvent) => void
  onViewportObservation?: (event: ViewportObservationChangedEvent) => void
  renderViewportOverlay?: (input: {
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
    observation: ViewportObservationChangedEvent | null
    commands: MessageViewportCommands
  }) => ReactNode
  scrollbar?: 'custom' | 'native'
}
