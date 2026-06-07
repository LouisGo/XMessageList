import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { getMessageListAdapterRuntime } from '../../core/runtime/internal'
import type {
  MessageDataItem,
  MessageListRuntime,
} from '../../core/runtime/index'
import type {
  MessageListSession,
  MessageListViewState,
} from '../../core/session-registry/index'
import {
  getMessageListSessionInternals,
  type MessageListSessionInternals,
} from '../../core/session-registry/internal'
import { MessageFlow } from './MessageFlow'
import { MessageListScrollbarOverlay } from '../scrollbar/MessageListScrollbarOverlay'
import { useExternalStoreSource } from '../hooks/useExternalStoreSource'
import { useMessageListSnapshot } from '../hooks/useMessageListSnapshot'
import { ProjectionCommitAck } from './ProjectionCommitAck'
import { RuntimeEventBridge } from './RuntimeEventBridge'
import type { MessageListProps } from '../types'

const noopSubscribe = () => () => undefined
const SCROLL_TO_LATEST_VISIBILITY_DISTANCE_PX = 200

function MessageListInner<TMessage, TOptimistic>({
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
  const sessionInternals = useMemo(
    () => getMessageListSessionInternals(session),
    [session],
  )
  const resolvedRuntime = sessionInternals.runtime
  const snapshot = useMessageListSnapshot(resolvedRuntime)
  const viewState = useMessageListViewState(session)
  const adapterRuntime = getMessageListAdapterRuntime(resolvedRuntime)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrollToLatestVisibleByDistance = useScrollToLatestVisibleByDistance(
    resolvedRuntime,
    Boolean(renderScrollToLatest),
  )
  const commands = useMemo(() => ({
    scrollToLatest: session.commands.scrollToLatest,
    scrollToMessage: session.commands.scrollToMessage,
  }), [session])
  const reload = useCallback(() => {
    session.commands.reloadLatest()
  }, [session])

  const scrollToLatestInput = renderScrollToLatest
    ? {
        visibleByScroll: snapshot.bottomLockState === 'UNLOCKED' &&
          snapshot.pendingIntent !== 'follow-bottom' &&
          (
            snapshot.segmentMeta.hasMoreAfter ||
            scrollToLatestVisibleByDistance
          ),
        scrollToLatest: commands.scrollToLatest,
        bottomLockState: snapshot.bottomLockState,
        hasMoreAfter: snapshot.segmentMeta.hasMoreAfter,
        pendingIntent: snapshot.pendingIntent,
        viewportPhase: snapshot.viewportPhase,
      }
    : null
  const resolveRowRenderVersion = useMemo(() => {
    if (getRowRenderVersion) {
      return getRowRenderVersion
    }

    return (item: MessageDataItem<TMessage, TOptimistic>) =>
      sessionInternals.getRowRenderVersion(item as MessageDataItem<TMessage>)
  }, [getRowRenderVersion, sessionInternals])
  const usesRowRenderVersion = Boolean(getRowRenderVersion)
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
  useEffect(() => {
    const release = sessionInternals.retainView()
    return release
  }, [sessionInternals])
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
          usesRowRenderVersion={usesRowRenderVersion}
          renderBeforeStatus={renderBeforeStatus}
          renderAfterStatus={renderAfterStatus}
          renderTopPlaceholder={renderTopPlaceholder}
          renderEmpty={renderEmpty}
          reload={reload}
        />
        {renderScrollToLatest && scrollToLatestInput
          ? renderScrollToLatest(scrollToLatestInput)
          : null}
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



function areMessageListPropsEqual<TMessage, TOptimistic>(
  prev: MessageListProps<TMessage, TOptimistic>,
  next: MessageListProps<TMessage, TOptimistic>,
): boolean {
  if (prev.session !== next.session) return false
  if (prev.className !== next.className) return false
  if (prev.scrollbar !== next.scrollbar) return false

  if (prev.style !== next.style) {
    if (!prev.style || !next.style) return false
    const prevKeys = Object.keys(prev.style)
    const nextKeys = Object.keys(next.style)
    if (prevKeys.length !== nextKeys.length) return false
    for (const key of prevKeys) {
      if (
        (prev.style as Record<string, unknown>)[key] !==
        (next.style as Record<string, unknown>)[key]
      ) {
        return false
      }
    }
  }

  if (prev.renderRow !== next.renderRow) return false
  if (prev.renderBeforeStatus !== next.renderBeforeStatus) return false
  if (prev.renderAfterStatus !== next.renderAfterStatus) return false
  if (prev.renderEmpty !== next.renderEmpty) return false
  if (prev.renderOverlayStatus !== next.renderOverlayStatus) return false
  if (prev.renderScrollToLatest !== next.renderScrollToLatest) return false
  if (prev.renderTopPlaceholder !== next.renderTopPlaceholder) return false
  if (prev.getRowRenderVersion !== next.getRowRenderVersion) return false
  if (prev.onViewportAnchorChange !== next.onViewportAnchorChange) return false
  if (prev.onViewportObservationChange !== next.onViewportObservationChange) return false

  return true
}

/** 渲染单个 MessageList session，并把 React commit ack、viewport events 和滚动条接入 runtime。 */
export const MessageList = memo(
  MessageListInner,
  areMessageListPropsEqual,
) as typeof MessageListInner

function useMessageListViewState(
  session: MessageListSession<unknown>,
): MessageListViewState {
  const sessionInternals = getMessageListSessionInternals(session)

  return useExternalStoreSource(
    sessionInternals,
    subscribeMessageListViewState,
    getMessageListViewState,
  )
}

function useScrollToLatestVisibleByDistance(
  runtime: MessageListRuntime<unknown>,
  enabled: boolean,
): boolean {
  const source = useMemo(() => ({
    enabled,
    runtime,
  }), [enabled, runtime])

  return useExternalStoreSource(
    source,
    subscribeScrollToLatestVisibility,
    getScrollToLatestVisibility,
  )
}

function subscribeMessageListViewState(
  sessionInternals: MessageListSessionInternals<unknown>,
  listener: () => void,
): () => void {
  return sessionInternals.subscribeView(listener)
}

function getMessageListViewState(
  sessionInternals: MessageListSessionInternals<unknown>,
): MessageListViewState {
  return sessionInternals.getViewState()
}

type ScrollToLatestVisibilitySource = {
  runtime: MessageListRuntime<unknown>
  enabled: boolean
}

function subscribeScrollToLatestVisibility(
  source: ScrollToLatestVisibilitySource,
  listener: () => void,
): () => void {
  if (!source.enabled) {
    return noopSubscribe()
  }

  return source.runtime.subscribeViewportObservation(() => {
    listener()
  })
}

function getScrollToLatestVisibility(
  source: ScrollToLatestVisibilitySource,
): boolean {
  return source.enabled
    ? resolveScrollToLatestVisibleByDistance(source.runtime)
    : false
}

function resolveScrollToLatestVisibleByDistance(
  runtime: MessageListRuntime<unknown>,
): boolean {
  const evidence = runtime.getEvidence()
  const distanceToBottom = Math.max(
    0,
    evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop,
  )

  return distanceToBottom > SCROLL_TO_LATEST_VISIBILITY_DISTANCE_PX
}
