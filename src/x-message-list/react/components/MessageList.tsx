import {
  memo,
  useCallback,
  useLayoutEffect,
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
import type { ViewAttachmentToken } from '../../core/runtime/internal'

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
  onViewActivationChange,
  activationKey,
  presentation = 'active',
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
  const rootRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const attachmentTokenRef = useRef<ViewAttachmentToken | null>(null)
  const presentationRef = useRef(presentation)
  const viewRetentionRef = useRef<ReturnType<
    MessageListSessionInternals<TMessage>['retainView']
  > | null>(null)
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
        loadedContext: snapshot.segmentMeta.context,
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
    ...style,
    position: 'relative' as const,
    minWidth: 0,
    minHeight: 0,
    pointerEvents: presentation === 'staging' ? 'none' as const : undefined,
  }), [presentation, style])
  const attachContainer = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element
    if (element) {
      attachmentTokenRef.current = adapterRuntime.attachView(element)
      return
    }

    attachmentTokenRef.current = null
    resolvedRuntime.detachScrollContainer()
  }, [adapterRuntime, resolvedRuntime])
  useLayoutEffect(() => {
    presentationRef.current = presentation
  }, [presentation])
  useLayoutEffect(() => {
    const retention = sessionInternals.retainView(presentationRef.current)
    viewRetentionRef.current = retention
    return () => {
      viewRetentionRef.current = null
      retention.release()
    }
  }, [sessionInternals])
  useLayoutEffect(() => {
    viewRetentionRef.current?.setPresentation(presentation)
  }, [presentation])
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (presentation === 'staging') root.setAttribute('inert', '')
    else root.removeAttribute('inert')
  }, [presentation])
  useLayoutEffect(() => {
    const token = attachmentTokenRef.current
    if (!token) return
    attachmentTokenRef.current = null
    adapterRuntime.ackViewAttachment(token)
  })
  return (
    <div
      ref={rootRef}
      data-message-list
      data-message-list-presentation={presentation}
      data-scrollbar-mode={scrollbar}
      data-custom-scrollbar={scrollbar === 'custom' ? 'true' : 'false'}
      aria-hidden={presentation === 'staging' ? true : undefined}
      className={className}
      style={rootStyle}
    >
      <div
        ref={attachContainer}
        data-message-scroll-container
        style={scrollContainerStyle}
      >
        <RuntimeEventBridge
          runtime={resolvedRuntime}
          session={session}
          presentation={presentation}
          activationKey={activationKey}
          onViewportAnchorChange={onViewportAnchorChange}
          onViewportObservationChange={onViewportObservationChange}
          onViewActivationChange={onViewActivationChange}
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
        <ProjectionCommitAck
          runtime={adapterRuntime}
          token={snapshot.commitToken}
        />
      </div>
      {renderScrollToLatest && scrollToLatestInput ? (
        <div
          data-message-list-affordance-layer
          style={affordanceLayerStyle}
        >
          <div style={affordanceContentStyle}>
            {renderScrollToLatest(scrollToLatestInput)}
          </div>
        </div>
      ) : null}
      {renderOverlayStatus ? (
        <div
          data-message-list-overlay-layer
          style={overlayLayerStyle}
        >
          <div
            data-message-list-overlay-content
            style={overlayContentStyle}
          >
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

const scrollContainerStyle = {
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  overflowX: 'hidden',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  overflowAnchor: 'none',
} as const

const affordanceLayerStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 2,
  pointerEvents: 'none',
} as const

const affordanceContentStyle = {
  display: 'contents',
  pointerEvents: 'auto',
} as const

const overlayLayerStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 3,
  pointerEvents: 'none',
} as const

const overlayContentStyle = {
  pointerEvents: 'auto',
} as const



function areMessageListPropsEqual<TMessage, TOptimistic>(
  prev: MessageListProps<TMessage, TOptimistic>,
  next: MessageListProps<TMessage, TOptimistic>,
): boolean {
  if (prev.session !== next.session) return false
  if (prev.className !== next.className) return false
  if (prev.scrollbar !== next.scrollbar) return false
  if (prev.presentation !== next.presentation) return false
  if (prev.activationKey !== next.activationKey) return false

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
  if (prev.onViewActivationChange !== next.onViewActivationChange) return false

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
