import { useCallback } from 'react'
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

  return (
    <div
      ref={registerFlow}
      data-message-flow
      data-short-align={snapshot.segmentMeta.shortSegmentAlignment}
    >
      <div ref={registerBefore} data-edge-trigger="before">
        {renderBeforeStatus?.(
          toEdgeSlotInput(
            snapshot.edgeState.before.status,
            () => runtime.retryEdgeRequest('before'),
          ),
        )}
      </div>
      {renderTopPlaceholder ? (
        <div data-message-top-placeholder>
          {renderTopPlaceholder()}
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
              usesRowRenderVersion={Boolean(getRowRenderVersion)}
            />
          ))}
      <div ref={registerAfter} data-edge-trigger="after">
        {renderAfterStatus?.(
          toEdgeSlotInput(
            snapshot.edgeState.after.status,
            () => runtime.retryEdgeRequest('after'),
          ),
        )}
      </div>
      <div ref={registerBottom} data-bottom-marker />
    </div>
  )
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
