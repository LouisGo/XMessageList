import {
  type CSSProperties,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import type {
  MessageIdentityAnchor,
  ViewportAnchorChangedEvent,
  ViewportObservationChangedEvent,
} from '../../runtime'
import { useElementRef, useStableCallback } from '../hooks/stableState'
import { baseViewportStyle } from './styles'
import type { MessageViewportCommands, MessageViewportProps } from './types'
import { ProjectionCommitAck } from './ProjectionCommitAck'
import { RuntimeScrollContainer } from './RuntimeScrollContainer'
import { MessageWindowProjection } from './MessageWindowProjection'
import { CustomScrollbarBridge } from './CustomScrollbarBridge'
import {
  CustomEdgeProjection,
  FollowBottomProjection,
  ViewportOverlayProjection,
} from './ViewportSlots'

/**
 * MessageViewport 是 runtime projection shell。
 * DOM 顺序固定为 sentinel -> spacer -> flow rows -> spacer -> sentinel，
 * 方便 runtime 做 commit 后测量和 anchor correction。
 */
export function MessageViewport<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  runtime,
  renderMessage,
  getRowRenderVersion,
  className,
  aiRegion,
  enableAiDomAttributes = false,
  style,
  renderTopEdge,
  renderBottomEdge,
  renderFollowBottom,
  onViewportAnchorChanged,
  onViewportObservation,
  renderViewportOverlay,
  scrollbar,
}: MessageViewportProps<TMessage, TOptimistic>) {
  const [observation, setObservation] =
    useState<ViewportObservationChangedEvent | null>(null)
  const [containerRef, containerElement, setContainerRef] =
    useElementRef<HTMLDivElement>()
  const viewportStyle = useMemo<CSSProperties>(
    () => ({
      ...baseViewportStyle,
      ...style,
    }),
    [style],
  )
  const scrollbarMode = scrollbar ?? 'custom'
  const customScrollbarEnabled = scrollbarMode === 'custom'
  const stableOnViewportAnchorChanged = useStableCallback(
    (event: ViewportAnchorChangedEvent) => {
      onViewportAnchorChanged?.(event)
    },
  )
  const stableOnViewportObservation = useStableCallback(
    (event: ViewportObservationChangedEvent) => {
      onViewportObservation?.(event)

      if (!renderViewportOverlay || event.reason === 'detach') {
        return
      }

      const snapshot = runtime.getSnapshot()

      if (
        event.feedId !== snapshot.feedId ||
        event.generation !== snapshot.generation
      ) {
        return
      }

      setObservation(event)
    },
  )
  const followBottom = useStableCallback(() => {
    runtime.dispatch({ type: 'followBottom' })
  })
  const jump = useStableCallback(
    (target: MessageIdentityAnchor, origin?: MessageIdentityAnchor) => {
      runtime.dispatch({
        type: 'jump',
        target,
        origin,
      })
    },
  )
  const commands = useMemo<MessageViewportCommands>(
    () => ({
      followBottom,
      jump,
    }),
    [followBottom, jump],
  )

  useLayoutEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    runtime.attach(container)
  }, [containerRef, runtime])

  const wantsObservationEvents = Boolean(
    onViewportObservation || renderViewportOverlay,
  )

  return (
    <div
      className={className}
      data-message-viewport
      data-testid="message-viewport"
      data-ai-region={aiRegion}
      data-custom-scrollbar={customScrollbarEnabled ? 'true' : 'false'}
      style={viewportStyle}
    >
      <ProjectionCommitAck runtime={runtime} />
      <RuntimeScrollContainer
        runtime={runtime}
        onViewportAnchorChanged={
          onViewportAnchorChanged ? stableOnViewportAnchorChanged : undefined
        }
        onViewportObservation={
          wantsObservationEvents ? stableOnViewportObservation : undefined
        }
        setContainerRef={setContainerRef}
      >
        <MessageWindowProjection
          runtime={runtime}
          renderMessage={renderMessage}
          getRowRenderVersion={getRowRenderVersion}
          enableAiDomAttributes={enableAiDomAttributes}
        />
      </RuntimeScrollContainer>
      {customScrollbarEnabled && (
        <CustomScrollbarBridge
          container={containerElement}
          runtime={runtime}
          enabled
        />
      )}
      {(renderTopEdge || renderBottomEdge) && (
        <CustomEdgeProjection
          runtime={runtime}
          renderTopEdge={renderTopEdge}
          renderBottomEdge={renderBottomEdge}
        />
      )}
      <FollowBottomProjection
        runtime={runtime}
        renderFollowBottom={renderFollowBottom}
        followBottom={followBottom}
      />
      {renderViewportOverlay && (
        <ViewportOverlayProjection
          runtime={runtime}
          renderViewportOverlay={renderViewportOverlay}
          observation={observation}
          commands={commands}
        />
      )}
    </div>
  )
}
