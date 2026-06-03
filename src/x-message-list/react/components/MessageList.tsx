import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { getMessageListAdapterRuntime } from '../../core/runtime/internal'
import type {
  MessageDataItem,
} from '../../core/runtime/index'
import type {
  MessageListSession,
  MessageListViewState,
} from '../../core/session-registry/index'
import { getMessageListSessionInternals } from '../../core/session-registry/internal'
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
  const [
    scrollToLatestObservationRevision,
    setScrollToLatestObservationRevision,
  ] = useState(0)
  const commands = useMemo(() => ({
    scrollToLatest: session.commands.scrollToLatest,
    scrollToMessage: session.commands.scrollToMessage,
  }), [session])
  const reload = useCallback(() => {
    session.commands.reloadLatest()
  }, [session])
  const scrollToLatestInput = useMemo(
    () => {
      if (!renderScrollToLatest) {
        return null
      }

      const evidence = resolvedRuntime.getEvidence()
      const distanceToBottom = Math.max(
        0,
        evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop,
      )

      return {
        visible: snapshot.bottomLockState === 'UNLOCKED' &&
          snapshot.pendingIntent !== 'follow-bottom',
        scrollToLatest: commands.scrollToLatest,
        bottomLockState: snapshot.bottomLockState,
        hasMoreAfter: snapshot.segmentMeta.hasMoreAfter,
        pendingIntent: snapshot.pendingIntent,
        viewportPhase: snapshot.viewportPhase,
        distanceToBottom,
        pageFocused: resolvePageFocus(),
      }
    },
    [
      resolvedRuntime,
      snapshot.bottomLockState,
      snapshot.pendingIntent,
      snapshot.projectionRevision,
      snapshot.segmentMeta.hasMoreAfter,
      snapshot.viewportPhase,
      scrollToLatestObservationRevision,
      commands.scrollToLatest,
      renderScrollToLatest,
    ],
  )
  const handleViewportObservationForSlots = useCallback(() => {
    if (renderScrollToLatest) {
      setScrollToLatestObservationRevision((revision) => revision + 1)
    }
  }, [renderScrollToLatest])
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
          onViewportObservationInternal={handleViewportObservationForSlots}
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

export const MessageList = memo(
  MessageListInner,
  areMessageListPropsEqual,
) as typeof MessageListInner

function resolvePageFocus(): boolean {
  return globalThis.document?.hasFocus?.() ?? true
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
