import {
  memo,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import {
  getItemContentVersion,
  getRuntimeItemKey,
  serializeRuntimeItemKey,
} from '../../runtime'
import type {
  MessageDataItem,
  MessageRuntimeItemKey,
  MessageViewportRuntime,
} from '../../runtime'
import type { MessageViewportProps } from './types'
import { normalFlowRowStyle, messageWindowStyle } from './styles'

type MessageRowProjectionProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  item: MessageDataItem<TMessage, TOptimistic>
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  children: ReactNode
  enableAiDomAttributes?: boolean
  testId?: string
}

function MessageRowProjection<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  item,
  runtime,
  children,
  enableAiDomAttributes = false,
  testId,
}: MessageRowProjectionProps<TMessage, TOptimistic>) {
  const key = useMemo(() => getRuntimeItemKey(item), [item])
  const serializedKey = serializeRuntimeItemKey(key)
  const rowElementRef = useRef<HTMLDivElement | null>(null)
  const messageId =
    enableAiDomAttributes && key.kind === 'committed'
      ? key.messageId
      : undefined
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      rowElementRef.current = element
      runtime.registerRow(key, element)
    },
    [runtime, key],
  )

  useLayoutEffect(() => {
    const element = rowElementRef.current

    if (element) {
      // StrictMode 会重放 layout effect，但不一定重放 ref callback；这里补回 runtime row registry。
      runtime.registerRow(key, element)
    }

    return () => {
      runtime.registerRow(key, null)
    }
  }, [runtime, key])

  return (
    <div
      ref={setRef}
      data-message-row={serializedKey}
      data-message-id={messageId}
      data-ai-role={enableAiDomAttributes ? 'message-row' : undefined}
      data-testid={testId}
      style={normalFlowRowStyle}
    >
      {children}
    </div>
  )
}

type MemoizedMessageRowProjectionProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  item: MessageDataItem<TMessage, TOptimistic>
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderMessage: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  rowRenderVersion?: unknown
  usesExplicitRowRenderVersion: boolean
  enableAiDomAttributes?: boolean
  testId?: string
}

const MemoizedMessageRowProjection = memo(
  function MemoizedMessageRowProjection<
    TMessage = unknown,
    TOptimistic = unknown,
  >({
    item,
    runtime,
    renderMessage,
    enableAiDomAttributes,
    testId,
  }: MemoizedMessageRowProjectionProps<TMessage, TOptimistic>) {
    return (
      <MessageRowProjection
        item={item}
        runtime={runtime}
        enableAiDomAttributes={enableAiDomAttributes}
        testId={testId}
      >
        {renderMessage(item)}
      </MessageRowProjection>
    )
  },
  areMessageRowProjectionPropsEqual,
) as <TMessage = unknown, TOptimistic = unknown>(
  props: MemoizedMessageRowProjectionProps<TMessage, TOptimistic>,
) => ReactNode

function areMessageRowProjectionPropsEqual<TMessage, TOptimistic>(
  previous: MemoizedMessageRowProjectionProps<TMessage, TOptimistic>,
  next: MemoizedMessageRowProjectionProps<TMessage, TOptimistic>,
): boolean {
  const renderMessageEqual =
    previous.usesExplicitRowRenderVersion && next.usesExplicitRowRenderVersion
      ? true
      : previous.renderMessage === next.renderMessage

  return (
    previous.runtime === next.runtime &&
    renderMessageEqual &&
    previous.usesExplicitRowRenderVersion ===
      next.usesExplicitRowRenderVersion &&
    previous.enableAiDomAttributes === next.enableAiDomAttributes &&
    Object.is(previous.rowRenderVersion, next.rowRenderVersion) &&
    previous.testId === next.testId &&
    serializeRuntimeItemKey(getRuntimeItemKey(previous.item)) ===
      serializeRuntimeItemKey(getRuntimeItemKey(next.item)) &&
    previous.item.version === next.item.version &&
    getItemContentVersion(previous.item) === getItemContentVersion(next.item)
  )
}

export type MessageRowsProjectionProps<TMessage, TOptimistic> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderMessage: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  getRowRenderVersion?: MessageViewportProps<
    TMessage,
    TOptimistic
  >['getRowRenderVersion']
  enableAiDomAttributes?: boolean
  items: Array<MessageDataItem<TMessage, TOptimistic>>
}

export const MessageRowsProjection = memo(
  function MessageRowsProjection<TMessage = unknown, TOptimistic = unknown>({
    items,
    runtime,
    renderMessage,
    getRowRenderVersion,
    enableAiDomAttributes = false,
  }: MessageRowsProjectionProps<TMessage, TOptimistic>) {
    const rows = items.map((item) => {
      const key: MessageRuntimeItemKey = getRuntimeItemKey(item)
      const serializedKey = serializeRuntimeItemKey(key)

      return (
        <MemoizedMessageRowProjection
          key={serializedKey}
          item={item}
          runtime={runtime}
          renderMessage={renderMessage}
          rowRenderVersion={getRowRenderVersion?.(item)}
          usesExplicitRowRenderVersion={Boolean(getRowRenderVersion)}
          enableAiDomAttributes={enableAiDomAttributes}
          testId={`message-row-${serializedKey}`}
        />
      )
    })

    return (
      <div data-message-window style={messageWindowStyle}>
        {rows}
      </div>
    )
  },
  areMessageRowsProjectionPropsEqual,
) as <TMessage = unknown, TOptimistic = unknown>(
  props: MessageRowsProjectionProps<TMessage, TOptimistic>,
) => ReactNode

function areMessageRowsProjectionPropsEqual<TMessage, TOptimistic>(
  previous: MessageRowsProjectionProps<TMessage, TOptimistic>,
  next: MessageRowsProjectionProps<TMessage, TOptimistic>,
): boolean {
  const previousUsesExplicitVersion = Boolean(previous.getRowRenderVersion)
  const nextUsesExplicitVersion = Boolean(next.getRowRenderVersion)

  if (previousUsesExplicitVersion || nextUsesExplicitVersion) {
    return false
  }

  return (
    previous.items === next.items &&
    previous.runtime === next.runtime &&
    previous.renderMessage === next.renderMessage &&
    previous.getRowRenderVersion === next.getRowRenderVersion &&
    previous.enableAiDomAttributes === next.enableAiDomAttributes
  )
}
