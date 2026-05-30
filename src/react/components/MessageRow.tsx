import { memo, type ReactNode, useCallback } from 'react'
import type { MessageDataItem } from '../../runtime/index'
import type { MessageListAdapterRuntime } from '../../runtime/internal'

export type MessageRowProps<TMessage, TOptimistic> = {
  item: MessageDataItem<TMessage, TOptimistic>
  runtime: MessageListAdapterRuntime<TMessage, TOptimistic>
  renderRow: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  rowRenderVersion?: unknown
  usesRowRenderVersion: boolean
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

function areMessageRowPropsEqual<TMessage, TOptimistic>(
  previous: MessageRowProps<TMessage, TOptimistic>,
  next: MessageRowProps<TMessage, TOptimistic>,
): boolean {
  const renderRowEqual = next.usesRowRenderVersion
    ? true
    : previous.renderRow === next.renderRow

  return previous.runtime === next.runtime &&
    previous.item.key === next.item.key &&
    previous.item.renderVersion === next.item.renderVersion &&
    previous.usesRowRenderVersion === next.usesRowRenderVersion &&
    Object.is(previous.rowRenderVersion, next.rowRenderVersion) &&
    renderRowEqual
}

export const MessageRow = memo(
  MessageRowInner,
  areMessageRowPropsEqual,
) as typeof MessageRowInner
