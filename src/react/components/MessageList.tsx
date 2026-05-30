import { useCallback, useMemo, useRef, useState } from 'react'
import { getMessageListAdapterRuntime } from '../../runtime/internal'
import type { ViewportObservationChangedEvent } from '../../runtime/index'
import { MessageFlow } from './MessageFlow'
import { MessageListScrollbarOverlay } from '../scrollbar/MessageListScrollbarOverlay'
import { useMessageListSnapshot } from '../hooks/useMessageListSnapshot'
import { ProjectionCommitAck } from './ProjectionCommitAck'
import { RuntimeEventBridge } from './RuntimeEventBridge'
import type { MessageListProps } from '../types'

export function MessageList<TMessage, TOptimistic>({
  runtime,
  className,
  style,
  renderAfterEdge,
  renderBeforeEdge,
  renderOverlay,
  renderRow,
  renderScrollToLatest,
  getRowRenderVersion,
  onViewportAnchorChange,
  onViewportObservationChange,
  scrollbar = 'native',
}: MessageListProps<TMessage, TOptimistic>) {
  const snapshot = useMessageListSnapshot(runtime)
  const adapterRuntime = getMessageListAdapterRuntime(runtime)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [observation, setObservation] =
    useState<ViewportObservationChangedEvent | null>(null)
  const commands = useMemo(() => ({
    scrollToLatest: () => runtime.scrollToLatest(),
    scrollToMessage: runtime.scrollToMessage.bind(runtime),
  }), [runtime])
  const rootStyle = useMemo(() => ({
    position: 'relative' as const,
    ...style,
  }), [style])
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
      data-scrollbar-mode={scrollbar}
      className={className}
      style={rootStyle}
    >
      <div
        ref={attachContainer}
        data-message-scroll-container
      >
        <RuntimeEventBridge
          runtime={runtime}
          onViewportAnchorChange={onViewportAnchorChange}
          onViewportObservationChange={onViewportObservationChange}
          onViewportObservationForOverlay={renderOverlay ? setObservation : undefined}
        />
        <MessageFlow
          runtime={adapterRuntime}
          snapshot={snapshot}
          renderRow={renderRow}
          getRowRenderVersion={getRowRenderVersion}
          renderBeforeEdge={renderBeforeEdge}
          renderAfterEdge={renderAfterEdge}
        />
        {renderScrollToLatest?.({
          visible: snapshot.bottomLockState === 'UNLOCKED',
          scrollToLatest: () => runtime.scrollToLatest(),
        })}
        <ProjectionCommitAck
          runtime={adapterRuntime}
          token={snapshot.commitToken}
        />
      </div>
      {renderOverlay ? (
        <div data-message-list-overlay-layer>
          <div data-message-list-overlay-content>
            {renderOverlay({ snapshot, observation, commands })}
          </div>
        </div>
      ) : null}
      {scrollbar === 'custom'
        ? (
            <MessageListScrollbarOverlay
              containerRef={containerRef}
              runtime={adapterRuntime}
              projectionRevision={snapshot.projectionRevision}
            />
          )
        : null}
    </div>
  )
}
