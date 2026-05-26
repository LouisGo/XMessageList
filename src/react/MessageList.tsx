import { useCallback, useRef } from 'react'
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
