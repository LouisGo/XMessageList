import { useLayoutEffect } from 'react'
import type {
  MessageListRuntime,
} from '../../core/runtime/index'
import { useLatestCallback } from '../hooks/useLatestCallback'
import type { MessageListProps } from '../types'

export type RuntimeEventBridgeProps<TMessage, TOptimistic> = Pick<
  MessageListProps<TMessage, TOptimistic>,
  | 'onViewportAnchorChange'
  | 'onViewportObservationChange'
> & {
  runtime: MessageListRuntime<TMessage, TOptimistic>
}

/**
 * 将 runtime 事件订阅转接成 React props 回调；不参与 snapshot 投影，也不持有滚动状态。
 */
export function RuntimeEventBridge<TMessage, TOptimistic>({
  runtime,
  onViewportAnchorChange,
  onViewportObservationChange,
}: RuntimeEventBridgeProps<TMessage, TOptimistic>) {
  const handleViewportAnchorChange = useLatestCallback(onViewportAnchorChange)
  const handleViewportObservationChange = useLatestCallback(
    onViewportObservationChange,
  )

  useLayoutEffect(() => {
    const unsubscribers: Array<() => void> = []

    unsubscribers.push(runtime.subscribeRuntimeEvent((event) => {
      if (event.type === 'viewportAnchorChanged') {
        handleViewportAnchorChange(event)
      }
    }))

    unsubscribers.push(
      runtime.subscribeViewportObservation((event) => {
        handleViewportObservationChange(event)
      }),
    )

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [
    handleViewportAnchorChange,
    handleViewportObservationChange,
    runtime,
  ])

  return null
}
