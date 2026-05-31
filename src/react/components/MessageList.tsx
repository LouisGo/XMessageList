import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { getMessageListAdapterRuntime } from '../../runtime/internal'
import type {
  MessageDataItem,
  ViewportObservationChangedEvent,
} from '../../runtime/index'
import type {
  MessageListController,
  MessageListViewState,
} from '../../manager/index'
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
  controller,
  runtime,
  className,
  style,
  renderAfterEdge,
  renderAfterStatus,
  renderBeforeEdge,
  renderBeforeStatus,
  renderEmpty,
  renderOverlay,
  renderOverlayStatus,
  renderRow,
  renderScrollToLatest,
  renderTopPlaceholder,
  getRowRenderVersion,
  onViewportAnchorChange,
  onViewportObservationChange,
  scrollbar = 'native',
}: MessageListProps<TMessage, TOptimistic>) {
  const resolvedRuntime = controller?.runtime ?? runtime

  if (!resolvedRuntime) {
    throw new Error('MessageList requires either controller or runtime.')
  }

  const snapshot = useMessageListSnapshot(resolvedRuntime)
  const viewState = useMessageListViewState(controller)
  const adapterRuntime = getMessageListAdapterRuntime(resolvedRuntime)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [observation, setObservation] =
    useState<ViewportObservationChangedEvent | null>(null)
  const commands = useMemo(() => ({
    scrollToLatest: controller
      ? controller.commands.scrollToLatest
      : () => resolvedRuntime.scrollToLatest(),
    scrollToMessage: controller
      ? controller.commands.scrollToMessage
      : resolvedRuntime.scrollToMessage.bind(resolvedRuntime),
  }), [controller, resolvedRuntime])
  const reload = useCallback(() => {
    if (controller) {
      controller.commands.reloadLatest()
      return
    }

    resolvedRuntime.scrollToLatest()
  }, [controller, resolvedRuntime])
  const resolveRowRenderVersion = useMemo(() => {
    if (getRowRenderVersion) {
      return getRowRenderVersion
    }

    if (controller) {
      return (item: MessageDataItem<TMessage, TOptimistic>) =>
        controller.getRowRenderVersion(item as MessageDataItem<TMessage>)
    }

    return undefined
  }, [controller, getRowRenderVersion])
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
  const observesOverlay = Boolean(renderOverlay ?? renderOverlayStatus)

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
          onViewportObservationForOverlay={observesOverlay ? setObservation : undefined}
        />
        <MessageFlow
          runtime={adapterRuntime}
          snapshot={snapshot}
          renderRow={renderRow}
          getRowRenderVersion={resolveRowRenderVersion}
          renderBeforeStatus={renderBeforeStatus}
          renderBeforeEdge={renderBeforeEdge}
          renderAfterStatus={renderAfterStatus}
          renderAfterEdge={renderAfterEdge}
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
              snapshot,
              observation,
            })}
          </div>
        </div>
      ) : renderOverlay ? (
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

function useMessageListViewState(
  controller: MessageListController<unknown> | undefined,
): MessageListViewState {
  const subscribe = useCallback((listener: () => void) => {
    return controller
      ? controller.subscribeView(listener)
      : noopSubscribe()
  }, [controller])
  const getSnapshot = useCallback(() => {
    return controller?.getViewState() ?? idleViewState
  }, [controller])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
