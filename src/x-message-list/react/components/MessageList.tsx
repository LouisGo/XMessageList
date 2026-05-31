import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import { getMessageListAdapterRuntime } from '../../core/runtime/internal'
import type {
  MessageDataItem,
} from '../../core/runtime/index'
import type {
  MessageListSession,
  MessageListViewState,
} from '../../core/manager/index'
import { getMessageListSessionInternals } from '../../core/manager/internal'
import { MessageFlow } from './MessageFlow'
import { MessageListScrollbarOverlay } from '../scrollbar/MessageListScrollbarOverlay'
import { useMessageListSnapshot } from '../hooks/useMessageListSnapshot'
import { ProjectionCommitAck } from './ProjectionCommitAck'
import { RuntimeEventBridge } from './RuntimeEventBridge'
import type { MessageListProps } from '../types'

const noopSubscribe = () => () => undefined
const idleViewState: MessageListViewState = {
  overlayStatus: {
    status: 'idle',
    retry: () => undefined,
  },
}

/**
 * React 壳只投影 runtime snapshot、注册 DOM refs 并回传 commit ack；滚动和测量语义由 runtime 拥有。
 */
export function MessageList<TMessage, TOptimistic>({
  session,
  className,
  style,
  renderAfterStatus,
  renderBeforeStatus,
  renderEmpty,
  renderOverlayStatus,
  renderRow,
  renderScrollToLatest,
  renderTopPlaceholder,
  getRowRenderVersion,
  onViewportAnchorChange,
  onViewportObservationChange,
  scrollbar = 'native',
}: MessageListProps<TMessage, TOptimistic>) {
  const sessionInternals = getMessageListSessionInternals(session)
  const resolvedRuntime = sessionInternals.runtime
  const snapshot = useMessageListSnapshot(resolvedRuntime)
  const viewState = useMessageListViewState(session)
  const adapterRuntime = getMessageListAdapterRuntime(resolvedRuntime)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const commands = useMemo(() => ({
    scrollToLatest: session.commands.scrollToLatest,
    scrollToMessage: session.commands.scrollToMessage,
  }), [session])
  const reload = useCallback(() => {
    session.commands.reloadLatest()
  }, [session])
  const resolveRowRenderVersion = useMemo(() => {
    if (getRowRenderVersion) {
      return getRowRenderVersion
    }

    return (item: MessageDataItem<TMessage, TOptimistic>) =>
      sessionInternals.getRowRenderVersion(item as MessageDataItem<TMessage>)
  }, [getRowRenderVersion, sessionInternals])
  const rootStyle = useMemo(() => ({
    position: 'relative' as const,
    ...style,
  }), [style])
  const attachContainer = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element
    if (element) {
      resolvedRuntime.attachScrollContainer(element)
      return
    }

    resolvedRuntime.detachScrollContainer()
  }, [resolvedRuntime])
  useEffect(() => sessionInternals.retainView(), [sessionInternals])
  return (
    <div
      data-message-list
      data-scrollbar-mode={scrollbar}
      data-custom-scrollbar={scrollbar === 'custom' ? 'true' : 'false'}
      className={className}
      style={rootStyle}
    >
      <div
        ref={attachContainer}
        data-message-scroll-container
      >
        <RuntimeEventBridge
          runtime={resolvedRuntime}
          onViewportAnchorChange={onViewportAnchorChange}
          onViewportObservationChange={onViewportObservationChange}
        />
        <MessageFlow
          runtime={adapterRuntime}
          snapshot={snapshot}
          renderRow={renderRow}
          getRowRenderVersion={resolveRowRenderVersion}
          renderBeforeStatus={renderBeforeStatus}
          renderAfterStatus={renderAfterStatus}
          renderTopPlaceholder={renderTopPlaceholder}
          renderEmpty={renderEmpty}
          reload={reload}
        />
        {renderScrollToLatest?.({
          visible: snapshot.bottomLockState === 'UNLOCKED',
          scrollToLatest: commands.scrollToLatest,
        })}
        <ProjectionCommitAck
          runtime={adapterRuntime}
          token={snapshot.commitToken}
        />
      </div>
      {renderOverlayStatus ? (
        <div data-message-list-overlay-layer>
          <div data-message-list-overlay-content>
            {renderOverlayStatus({
              ...viewState.overlayStatus,
            })}
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

function useMessageListViewState(
  session: MessageListSession<unknown>,
): MessageListViewState {
  const sessionInternals = getMessageListSessionInternals(session)
  const subscribe = useCallback((listener: () => void) => {
    return sessionInternals
      ? sessionInternals.subscribeView(listener)
      : noopSubscribe()
  }, [sessionInternals])
  const getSnapshot = useCallback(() => {
    return sessionInternals?.getViewState() ?? idleViewState
  }, [sessionInternals])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
