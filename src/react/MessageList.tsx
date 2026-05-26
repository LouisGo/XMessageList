import { useCallback, useLayoutEffect, useRef } from 'react'
import { getMessageListAdapterRuntime } from '../runtime/internal'
import { MessageFlow } from './MessageFlow'
import { useMessageListSnapshot } from './hooks'
import { ProjectionCommitAck } from './ProjectionCommitAck'
import type { MessageListProps } from './types'

export function MessageList<TMessage, TOptimistic>({
  runtime,
  className,
  style,
  renderAfterEdge,
  renderBeforeEdge,
  renderOverlay,
  renderRow,
  renderScrollToLatest,
  onViewportAnchorChange,
  onViewportObservationChange,
}: MessageListProps<TMessage, TOptimistic>) {
  const snapshot = useMessageListSnapshot(runtime)
  const adapterRuntime = getMessageListAdapterRuntime(runtime)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const attachContainer = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element
    if (element) {
      runtime.attachScrollContainer(element)
      return
    }

    runtime.detachScrollContainer()
  }, [runtime])

  return (
    <div
      data-message-list
      className={className}
      style={style}
    >
      <div
        ref={attachContainer}
        data-message-scroll-container
      >
        <RuntimeEventBridge
          runtime={runtime}
          onViewportAnchorChange={onViewportAnchorChange}
          onViewportObservationChange={onViewportObservationChange}
        />
        <MessageFlow
          runtime={adapterRuntime}
          snapshot={snapshot}
          renderRow={renderRow}
          renderBeforeEdge={renderBeforeEdge}
          renderAfterEdge={renderAfterEdge}
        />
        {renderScrollToLatest?.({
          visible: snapshot.bottomLockState === 'UNLOCKED',
          scrollToLatest: () => runtime.scrollToLatest(),
        })}
        {renderOverlay?.({ snapshot })}
        <ProjectionCommitAck
          runtime={adapterRuntime}
          token={snapshot.commitToken}
        />
      </div>
    </div>
  )
}

type RuntimeEventBridgeProps<TMessage, TOptimistic> = Pick<
  MessageListProps<TMessage, TOptimistic>,
  | 'runtime'
  | 'onViewportAnchorChange'
  | 'onViewportObservationChange'
>

function RuntimeEventBridge<TMessage, TOptimistic>({
  runtime,
  onViewportAnchorChange,
  onViewportObservationChange,
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

    if (onViewportObservationChange) {
      unsubscribers.push(
        runtime.subscribeViewportObservation(onViewportObservationChange),
      )
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
    }
  }, [runtime, onViewportAnchorChange, onViewportObservationChange])

  return null
}
