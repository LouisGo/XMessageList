import { useCallback, useMemo } from 'react'
import type { MessageListSnapshot } from '../../core/runtime/index'
import type { MessageListAdapterRuntime } from '../../core/runtime/internal'
import { MessageRow } from './MessageRow'
import type { EdgeSlotInput, MessageListProps } from '../types'

export type MessageFlowProps<TMessage, TOptimistic> = Pick<
  MessageListProps<TMessage, TOptimistic>,
  | 'getRowRenderVersion'
  | 'renderAfterStatus'
  | 'renderBeforeStatus'
  | 'renderEmpty'
  | 'renderRow'
  | 'renderTopPlaceholder'
> & {
  runtime: MessageListAdapterRuntime<TMessage, TOptimistic>
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
  reload: () => void
  usesRowRenderVersion: boolean
}

export function MessageFlow<TMessage, TOptimistic>({
  runtime,
  snapshot,
  renderAfterStatus,
  renderBeforeStatus,
  renderEmpty,
  renderTopPlaceholder,
  getRowRenderVersion,
  renderRow,
  reload,
  usesRowRenderVersion,
}: MessageFlowProps<TMessage, TOptimistic>) {
  const registerFlow = useCallback((element: HTMLDivElement | null) => {
    runtime.registerMessageFlowElement(element)
  }, [runtime])
  const registerBefore = useCallback((element: HTMLDivElement | null) => {
    runtime.registerBeforeTriggerElement(element)
  }, [runtime])
  const registerAfter = useCallback((element: HTMLDivElement | null) => {
    runtime.registerAfterTriggerElement(element)
  }, [runtime])
  const registerBottom = useCallback((element: HTMLDivElement | null) => {
    runtime.registerBottomMarkerElement(element)
  }, [runtime])
  const retryBefore = useCallback(
    () => runtime.retryEdgeRequest('before'),
    [runtime],
  )
  const retryAfter = useCallback(
    () => runtime.retryEdgeRequest('after'),
    [runtime],
  )
  const beforeSlotInput = useMemo(
    () => toEdgeSlotInput(snapshot.edgeState.before.status, retryBefore),
    [snapshot.edgeState.before.status, retryBefore],
  )
  const afterSlotInput = useMemo(
    () => toEdgeSlotInput(snapshot.edgeState.after.status, retryAfter),
    [snapshot.edgeState.after.status, retryAfter],
  )
  const shouldRenderTopPlaceholder = Boolean(renderTopPlaceholder) &&
    snapshot.items.length > 0 &&
    !snapshot.segmentMeta.hasMoreBefore

  return (
    <div
      ref={registerFlow}
      data-message-flow
      data-short-align={snapshot.segmentMeta.shortSegmentAlignment}
      style={{
        ...messageFlowStyle,
        justifyContent: resolveShortSegmentAlignment(
          snapshot.segmentMeta.shortSegmentAlignment,
        ),
      }}
    >
      <div
        ref={registerBefore}
        data-edge-trigger="before"
        style={edgeMarkerStyle}
      >
        {renderBeforeStatus?.(beforeSlotInput)}
      </div>
      {shouldRenderTopPlaceholder ? (
        <div data-message-top-placeholder>
          {renderTopPlaceholder?.()}
        </div>
      ) : null}
      {snapshot.items.length === 0
        ? renderEmpty?.({ reload })
        : snapshot.items.map((item) => (
            <MessageRow
              key={item.key}
              item={item}
              runtime={runtime}
              renderRow={renderRow}
              rowRenderVersion={getRowRenderVersion?.(item)}
              usesRowRenderVersion={usesRowRenderVersion}
            />
          ))}
      <div
        ref={registerAfter}
        data-edge-trigger="after"
        style={edgeMarkerStyle}
      >
        {renderAfterStatus?.(afterSlotInput)}
      </div>
      <div
        ref={registerBottom}
        data-bottom-marker
        style={edgeMarkerStyle}
      />
    </div>
  )
}

const messageFlowStyle = {
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: '100%',
} as const

const edgeMarkerStyle = {
  flex: '0 0 auto',
  minHeight: 1,
} as const

function resolveShortSegmentAlignment(
  alignment: MessageListSnapshot['segmentMeta']['shortSegmentAlignment'],
): 'flex-start' | 'center' | 'flex-end' {
  if (alignment === 'center') {
    return 'center'
  }
  if (alignment === 'end') {
    return 'flex-end'
  }
  return 'flex-start'
}

function toEdgeSlotInput(
  status: EdgeSlotInput['status'],
  retry: () => void,
): EdgeSlotInput {
  return {
    status,
    retry,
  }
}
