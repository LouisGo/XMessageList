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
  private subscribedRuntime: MessageViewportRuntime<TMessage, TOptimistic> | null =
    null

  componentDidMount(): void {
    this.syncRuntimeEventSubscription()
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
    }

    this.syncRuntimeEventSubscription()
  }

  componentWillUnmount(): void {
    this.props.runtime.detach()
    this.clearRuntimeEventSubscription()
  }

  private syncRuntimeEventSubscription(): void {
    if (
      !this.props.onViewportAnchorChanged &&
      !this.props.onViewportObservation
    ) {
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
        return
      }

      if (event.type === 'viewportObservationChanged') {
        this.props.onViewportObservation?.(event)
      }
    })
  }

  private clearRuntimeEventSubscription(): void {
    this.unsubscribeRuntimeEvents?.()
    this.unsubscribeRuntimeEvents = null
    this.subscribedRuntime = null
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
