import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
} from 'react'
import {
  getRuntimeItemKey,
  serializeRuntimeItemKey,
} from '../runtime'
import type {
  AnchorState,
  MessageDataItem,
  MessageRuntimeItemKey,
  MessageViewportRuntime,
  MessageViewportSnapshot,
} from '../runtime'
import { useMessageViewportRuntime } from './useMessageViewportRuntime'

export type MessageRowProjectionProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  item: MessageDataItem<TMessage, TOptimistic>
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  children: ReactNode
  testId?: string
}

/**
 * Row wrapper 的职责只有 DOM 注册和正常文档流渲染。
 * 它不能测量、不能 dispatch command，也不能读写 scrollTop。
 */
export function MessageRowProjection<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  item,
  runtime,
  children,
  testId,
}: MessageRowProjectionProps<TMessage, TOptimistic>) {
  const key = getRuntimeItemKey(item)
  const serializedKey = serializeRuntimeItemKey(key)
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      runtime.registerRow(key, element)
    },
    [runtime, key],
  )

  return (
    <div
      ref={setRef}
      data-message-row={serializedKey}
      data-testid={testId}
      style={normalFlowRowStyle}
    >
      {children}
    </div>
  )
}

export type MessageViewportProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderMessage: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  className?: string
  style?: CSSProperties
  bottomSlot?: ReactNode
  renderTopEdge?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
  renderBottomEdge?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
  renderFollowBottom?: (input: {
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
    followBottom: () => void
  }) => ReactNode
  onViewportAnchorChange?: (
    anchor: AnchorState | null,
    reason: 'scroll-idle' | 'transaction-settle',
  ) => void
  renderOverlay?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
}

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
  className,
  style,
  bottomSlot,
  renderTopEdge,
  renderBottomEdge,
  renderFollowBottom,
  onViewportAnchorChange,
  renderOverlay,
}: MessageViewportProps<TMessage, TOptimistic>) {
  useLayoutEffect(() => {
    if (!onViewportAnchorChange) {
      return undefined
    }

    return runtime.subscribeEvent((event) => {
      if (event.type !== 'viewportAnchorChanged') {
        return
      }

      onViewportAnchorChange(event.anchor, event.reason)
    })
  }, [onViewportAnchorChange, runtime])

  const snapshot = useMessageViewportRuntime(runtime)
  const viewportStyle = useMemo<CSSProperties>(
    () => ({
      ...baseViewportStyle,
      ...style,
    }),
    [style],
  )
  const setContainerRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) {
        runtime.attach(element)
        return
      }

      runtime.detach()
    },
    [runtime],
  )
  const followBottom = useCallback(() => {
    runtime.dispatch({ type: 'followBottom' })
  }, [runtime])
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
  const followBottomNode =
    snapshot.bottomLockState === 'UNLOCKED'
      ? renderFollowBottom
        ? renderFollowBottom({ snapshot, followBottom })
        : (
            <button
              type="button"
              className="follow-bottom-button"
              data-message-follow-bottom
              data-testid="follow-bottom-button"
              onClick={followBottom}
            >
              Bottom
            </button>
          )
      : null

  return (
    <div
      className={className}
      data-message-viewport
      data-testid="message-viewport"
      data-bottom-lock-state={snapshot.bottomLockState}
      style={viewportStyle}
    >
      <div
        ref={setContainerRef}
        data-message-scroll-container
        data-testid="message-scroll-container"
        style={scrollContainerStyle}
      >
        <div ref={setTopSentinel} data-top-sentinel />
        <div
          ref={setTopSpacer}
          data-top-spacer
          style={{ height: snapshot.topSpacer }}
        />
        <div data-message-window style={messageWindowStyle}>
          {snapshot.items.map((item) => {
            const key: MessageRuntimeItemKey = getRuntimeItemKey(item)
            const serializedKey = serializeRuntimeItemKey(key)

            return (
            <MessageRowProjection
              key={serializedKey}
              item={item}
              runtime={runtime}
              testId={`message-row-${serializedKey}`}
            >
                {renderMessage(item)}
              </MessageRowProjection>
            )
          })}
        </div>
        <div
          ref={setBottomSpacer}
          data-bottom-spacer
          style={{ height: snapshot.bottomSpacer }}
        />
        <div ref={setBottomSentinel} data-bottom-sentinel />
      </div>
      {bottomSlot}
      {renderTopEdge?.(snapshot)}
      {renderBottomEdge?.(snapshot)}
      {followBottomNode}
      {renderOverlay?.(snapshot)}
    </div>
  )
}

const baseViewportStyle: CSSProperties = {
  overflow: 'hidden',
  position: 'relative',
}

const scrollContainerStyle: CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  overflowAnchor: 'none',
  position: 'relative',
}

const messageWindowStyle: CSSProperties = {
  display: 'block',
}

const normalFlowRowStyle: CSSProperties = {
  display: 'block',
  position: 'static',
}
