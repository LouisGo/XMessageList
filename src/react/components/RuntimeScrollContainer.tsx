import { Component, type ReactNode } from 'react'
import type {
  MessageViewportRuntime,
  ViewportAnchorChangedEvent,
  ViewportObservationChangedEvent,
} from '../../runtime'
import { scrollContainerStyle } from './styles'

export type RuntimeScrollContainerProps<TMessage, TOptimistic> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  onViewportAnchorChanged?: (event: ViewportAnchorChangedEvent) => void
  onViewportObservation?: (event: ViewportObservationChangedEvent) => void
  setContainerRef: (element: HTMLDivElement | null) => void
  children: ReactNode
}

export class RuntimeScrollContainer<
  TMessage = unknown,
  TOptimistic = unknown,
> extends Component<RuntimeScrollContainerProps<TMessage, TOptimistic>> {
  private unsubscribeRuntimeEvents: (() => void) | null = null

  private unsubscribeViewportObservation: (() => void) | null = null

  private subscribedRuntime: MessageViewportRuntime<TMessage, TOptimistic> | null =
    null

  private subscribedViewportObservationRuntime: MessageViewportRuntime<
    TMessage,
    TOptimistic
  > | null = null

  componentDidMount(): void {
    this.syncRuntimeEventSubscription()
    this.syncViewportObservationSubscription()
  }

  getSnapshotBeforeUpdate(
    prevProps: RuntimeScrollContainerProps<TMessage, TOptimistic>,
  ): null {
    if (prevProps.runtime !== this.props.runtime) {
      prevProps.runtime.detach()
    }

    return null
  }

  componentDidUpdate(
    prevProps: RuntimeScrollContainerProps<TMessage, TOptimistic>,
  ): void {
    // React requires componentDidUpdate when getSnapshotBeforeUpdate is present.
    if (prevProps.runtime !== this.props.runtime) {
      this.clearRuntimeEventSubscription()
      this.clearViewportObservationSubscription()
    }

    this.syncRuntimeEventSubscription()
    this.syncViewportObservationSubscription()
  }

  componentWillUnmount(): void {
    this.props.runtime.detach()
    this.clearRuntimeEventSubscription()
    this.clearViewportObservationSubscription()
  }

  private syncRuntimeEventSubscription(): void {
    if (!this.props.onViewportAnchorChanged) {
      this.clearRuntimeEventSubscription()
      return
    }

    if (
      this.subscribedRuntime === this.props.runtime &&
      this.unsubscribeRuntimeEvents
    ) {
      return
    }

    this.clearRuntimeEventSubscription()
    this.subscribedRuntime = this.props.runtime
    this.unsubscribeRuntimeEvents = this.props.runtime.subscribeEvent((event) => {
      if (event.type === 'viewportAnchorChanged') {
        this.props.onViewportAnchorChanged?.(event)
      }
    })
  }

  private clearRuntimeEventSubscription(): void {
    this.unsubscribeRuntimeEvents?.()
    this.unsubscribeRuntimeEvents = null
    this.subscribedRuntime = null
  }

  private syncViewportObservationSubscription(): void {
    if (!this.props.onViewportObservation) {
      this.clearViewportObservationSubscription()
      return
    }

    if (
      this.subscribedViewportObservationRuntime === this.props.runtime &&
      this.unsubscribeViewportObservation
    ) {
      return
    }

    this.clearViewportObservationSubscription()
    this.subscribedViewportObservationRuntime = this.props.runtime
    this.unsubscribeViewportObservation =
      this.props.runtime.subscribeViewportObservation((event) => {
        this.props.onViewportObservation?.(event)
      })
  }

  private clearViewportObservationSubscription(): void {
    this.unsubscribeViewportObservation?.()
    this.unsubscribeViewportObservation = null
    this.subscribedViewportObservationRuntime = null
  }

  render() {
    return (
      <div
        ref={this.props.setContainerRef}
        data-message-scroll-container
        data-testid="message-scroll-container"
        style={scrollContainerStyle}
      >
        {this.props.children}
      </div>
    )
  }
}
