import { memo, type ReactNode, useCallback } from 'react'
import type {
  MessageViewportRuntime,
  MessageViewportSnapshot,
} from '../../runtime'
import { useMessageViewportSelector } from '../hooks/useMessageViewportSnapshot'
import type { MessageViewportProps } from './types'
import { MessageRowsProjection } from './MessageRowProjection'

type MessageWindowProjectionSlice<TMessage, TOptimistic> = Pick<
  MessageViewportSnapshot<TMessage, TOptimistic>,
  | 'feedId'
  | 'generation'
  | 'items'
  | 'renderWindow'
  | 'topSpacer'
  | 'bottomSpacer'
>

function selectMessageWindowProjection<TMessage, TOptimistic>(
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): MessageWindowProjectionSlice<TMessage, TOptimistic> {
  return {
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    items: snapshot.items,
    renderWindow: snapshot.renderWindow,
    topSpacer: snapshot.topSpacer,
    bottomSpacer: snapshot.bottomSpacer,
  }
}

function areMessageWindowSlicesEqual<TMessage, TOptimistic>(
  previous: MessageWindowProjectionSlice<TMessage, TOptimistic>,
  next: MessageWindowProjectionSlice<TMessage, TOptimistic>,
): boolean {
  return (
    previous.feedId === next.feedId &&
    previous.generation === next.generation &&
    previous.items === next.items &&
    previous.renderWindow === next.renderWindow &&
    Object.is(previous.topSpacer, next.topSpacer) &&
    Object.is(previous.bottomSpacer, next.bottomSpacer)
  )
}

export type MessageWindowProjectionProps<TMessage, TOptimistic> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderMessage: MessageViewportProps<TMessage, TOptimistic>['renderMessage']
  getRowRenderVersion?: MessageViewportProps<
    TMessage,
    TOptimistic
  >['getRowRenderVersion']
  enableAiDomAttributes?: boolean
}

export const MessageWindowProjection = memo(
  function MessageWindowProjection<TMessage = unknown, TOptimistic = unknown>({
    runtime,
    renderMessage,
    getRowRenderVersion,
    enableAiDomAttributes = false,
  }: MessageWindowProjectionProps<TMessage, TOptimistic>) {
    const windowProjection = useMessageViewportSelector(
      runtime,
      selectMessageWindowProjection,
      areMessageWindowSlicesEqual,
    )
    const setTopSentinel = useCallback(
      (element: HTMLDivElement | null) => {
        runtime.registerTopSentinel(element)
      },
      [runtime],
    )
    const setBottomSentinel = useCallback(
      (element: HTMLDivElement | null) => {
        runtime.registerBottomSentinel(element)
      },
      [runtime],
    )
    const setTopSpacer = useCallback(
      (element: HTMLDivElement | null) => {
        runtime.registerTopSpacer(element)
      },
      [runtime],
    )
    const setBottomSpacer = useCallback(
      (element: HTMLDivElement | null) => {
        runtime.registerBottomSpacer(element)
      },
      [runtime],
    )

    return (
      <>
        <div ref={setTopSentinel} data-top-sentinel />
        <div
          ref={setTopSpacer}
          data-top-spacer
          style={{ height: windowProjection.topSpacer }}
        />
        <MessageRowsProjection
          items={windowProjection.items}
          runtime={runtime}
          renderMessage={renderMessage}
          getRowRenderVersion={getRowRenderVersion}
          enableAiDomAttributes={enableAiDomAttributes}
        />
        <div
          ref={setBottomSpacer}
          data-bottom-spacer
          style={{ height: windowProjection.bottomSpacer }}
        />
        <div ref={setBottomSentinel} data-bottom-sentinel />
      </>
    )
  },
  areMessageWindowProjectionPropsEqual,
) as <TMessage = unknown, TOptimistic = unknown>(
  props: MessageWindowProjectionProps<TMessage, TOptimistic>,
) => ReactNode

function areMessageWindowProjectionPropsEqual<TMessage, TOptimistic>(
  previous: MessageWindowProjectionProps<TMessage, TOptimistic>,
  next: MessageWindowProjectionProps<TMessage, TOptimistic>,
): boolean {
  const previousUsesExplicitVersion = Boolean(previous.getRowRenderVersion)
  const nextUsesExplicitVersion = Boolean(next.getRowRenderVersion)

  if (
    previous.runtime !== next.runtime ||
    previousUsesExplicitVersion !== nextUsesExplicitVersion ||
    previous.enableAiDomAttributes !== next.enableAiDomAttributes
  ) {
    return false
  }

  if (previousUsesExplicitVersion) {
    return false
  }

  return previous.renderMessage === next.renderMessage
}
