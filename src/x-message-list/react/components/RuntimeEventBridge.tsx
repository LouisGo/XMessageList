import { useLayoutEffect } from 'react'
import type {
  MessageListRuntime,
  ViewportObservationChangedEvent,
} from '../../core/runtime/index'
import type { MessageListProps } from '../types'

export type RuntimeEventBridgeProps<TMessage, TOptimistic> = Pick<
  MessageListProps<TMessage, TOptimistic>,
  | 'onViewportAnchorChange'
  | 'onViewportObservationChange'
> & {
  runtime: MessageListRuntime<TMessage, TOptimistic>
  onViewportObservationInternal?: (
    event: ViewportObservationChangedEvent,
  ) => void
}

/**
 * 将 runtime 事件订阅转接成 React props 回调；不参与 snapshot 投影，也不持有滚动状态。
 */
export function RuntimeEventBridge<TMessage, TOptimistic>({
  runtime,
  onViewportAnchorChange,
  onViewportObservationChange,
  onViewportObservationInternal,
}: RuntimeEventBridgeProps<TMessage, TOptimistic>) {
  useLayoutEffect(() => {
    const unsubscribers: Array<() => void> = []

    if (onViewportAnchorChange) {
      unsubscribers.push(runtime.subscribeRuntimeEvent((event) => {
        if (event.type === 'viewportAnchorChanged') {
          onViewportAnchorChange(event)
        }
      }))
    }

    if (onViewportObservationChange || onViewportObservationInternal) {
      unsubscribers.push(
        runtime.subscribeViewportObservation((event) => {
          onViewportObservationChange?.(event)
          onViewportObservationInternal?.(event)
        }),
      )
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [
    runtime,
    onViewportAnchorChange,
    onViewportObservationChange,
    onViewportObservationInternal,
  ])

  return null
}
