import { useCallback } from 'react'
import type { MessageListSnapshot } from '../runtime'
import type { MessageListAdapterRuntime } from '../runtime/internal'
import { MessageRow } from './MessageRow'
import type { EdgeSlotInput, MessageListProps } from './types'

export type MessageFlowProps<TMessage, TOptimistic> = Pick<
  MessageListProps<TMessage, TOptimistic>,
  'renderAfterEdge' | 'renderBeforeEdge' | 'renderRow'
> & {
  runtime: MessageListAdapterRuntime<TMessage, TOptimistic>
  snapshot: MessageListSnapshot<TMessage, TOptimistic>
}

export function MessageFlow<TMessage, TOptimistic>({
  runtime,
  snapshot,
  renderAfterEdge,
  renderBeforeEdge,
  renderRow,
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
        {renderBeforeEdge?.(toEdgeSlotInput(snapshot.edgeState.before.status))}
      </div>
      {snapshot.items.map((item) => (
        <MessageRow
          key={item.key}
          item={item}
          runtime={runtime}
          renderRow={renderRow}
        />
      ))}
      <div ref={registerAfter} data-edge-trigger="after">
        {renderAfterEdge?.(toEdgeSlotInput(snapshot.edgeState.after.status))}
      </div>
      <div ref={registerBottom} data-bottom-marker />
    </div>
  )
}

function toEdgeSlotInput(status: EdgeSlotInput['status']): EdgeSlotInput {
  return {
    status,
    retry: () => undefined,
  }
}
