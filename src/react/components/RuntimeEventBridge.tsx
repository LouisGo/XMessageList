import { useLayoutEffect } from 'react'
import type { ViewportObservationChangedEvent } from '../../runtime/index'
import type { MessageListProps } from '../types'

export type RuntimeEventBridgeProps<TMessage, TOptimistic> = Pick<
  MessageListProps<TMessage, TOptimistic>,
  | 'runtime'
  | 'onViewportAnchorChange'
  | 'onViewportObservationChange'
> & {
  onViewportObservationForOverlay?: (
    event: ViewportObservationChangedEvent,
  ) => void
}

export function RuntimeEventBridge<TMessage, TOptimistic>({
  runtime,
  onViewportAnchorChange,
  onViewportObservationChange,
  onViewportObservationForOverlay,
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

    if (onViewportObservationChange || onViewportObservationForOverlay) {
      unsubscribers.push(
        runtime.subscribeViewportObservation((event) => {
          onViewportObservationChange?.(event)
          onViewportObservationForOverlay?.(event)
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
    onViewportObservationForOverlay,
  ])

  return null
}
