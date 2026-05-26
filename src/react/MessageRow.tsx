import { memo, type ReactNode, useCallback } from 'react'
import type { MessageDataItem } from '../runtime'
import type { MessageListAdapterRuntime } from '../runtime/internal'

export type MessageRowProps<TMessage, TOptimistic> = {
  item: MessageDataItem<TMessage, TOptimistic>
  runtime: MessageListAdapterRuntime<TMessage, TOptimistic>
  renderRow: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
}

function MessageRowInner<TMessage, TOptimistic>({
  item,
  runtime,
  renderRow,
}: MessageRowProps<TMessage, TOptimistic>) {
  const registerRow = useCallback((element: HTMLDivElement | null) => {
    runtime.registerRowElement(item.key, element)
  }, [item.key, runtime])

  return (
    <div
      ref={registerRow}
      data-message-row={item.key}
      data-runtime-key={item.key}
      data-row-kind={item.rowKind}
      data-message-stable-id={item.identity?.stableId}
      data-message-server-id={item.identity?.serverId}
    >
      {renderRow(item)}
    </div>
  )
}

export const MessageRow = memo(MessageRowInner) as typeof MessageRowInner
