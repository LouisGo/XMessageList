import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import type { MessageViewportRuntime } from '../MessageViewportRuntime'
import { stringifyMessageRuntimeItemKey } from '../identity/itemKey'
import type {
  MessageDataItem,
  MessageRuntimeItemKey,
  MessageViewportSnapshot,
  ViewportAnchorChangedEvent,
} from '../types'
import { RuntimeNextCustomScrollbar } from './CustomScrollbar'
import { useMessageViewportRuntime } from './hooks'

export type RuntimeNextMessageRowProjectionProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  readonly item: MessageDataItem<TMessage, TOptimistic>
  readonly runtime: MessageViewportRuntime<TMessage, TOptimistic>
  readonly children: ReactNode
  readonly testId?: string
}

export type RuntimeNextMessageViewportProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  readonly runtime: MessageViewportRuntime<TMessage, TOptimistic>
  readonly renderMessage: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  readonly className?: string
  readonly style?: CSSProperties
  readonly bottomSlot?: ReactNode
  readonly renderTopEdge?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
  readonly renderBottomEdge?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
  readonly renderFollowBottom?: (input: {
    readonly snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
    readonly followBottom: () => void
  }) => ReactNode
  readonly renderOverlay?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
  readonly onViewportAnchorChange?: (event: ViewportAnchorChangedEvent) => void
  readonly customScrollbar?: boolean
}

export function RuntimeNextMessageRowProjection<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  item,
  runtime,
  children,
  testId,
}: RuntimeNextMessageRowProjectionProps<TMessage, TOptimistic>) {
  const key = item.key
  const serializedKey = stringifyMessageRuntimeItemKey(key)
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      runtime.registerRow(key, element)
    },
    [runtime, key],
  )

  return (
    <div
      ref={setRef}
      data-runtime-next-message-row={serializedKey}
      data-testid={testId}
      style={normalFlowRowStyle}
    >
      {children}
    </div>
  )
}

export function RuntimeNextMessageViewport<
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
  renderOverlay,
  onViewportAnchorChange,
  customScrollbar = true,
}: RuntimeNextMessageViewportProps<TMessage, TOptimistic>) {
  const snapshot = useMessageViewportRuntime(runtime)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewportStyle = useMemo<CSSProperties>(
    () => ({ ...baseViewportStyle, ...style }),
    [style],
  )
  const setContainerRef = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element
  }, [])
  const followBottom = useCallback(() => {
    runtime.dispatch({ type: 'followBottom' })
  }, [runtime])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null) return
    runtime.attach(container)

    return () => runtime.detach()
  }, [runtime])

  useEffect(() => {
    if (!onViewportAnchorChange) return undefined

    return runtime.subscribeEvent((event) => {
      if (event.type === 'viewportAnchorChanged') {
        onViewportAnchorChange(event)
      }
    })
  }, [onViewportAnchorChange, runtime])

  return (
    <div
      className={className}
      data-runtime-next-message-viewport
      data-bottom-lock-state={snapshot.bottomLockState}
      data-custom-scrollbar={customScrollbar ? 'true' : 'false'}
      style={viewportStyle}
    >
      <style>{runtimeNextViewportCss}</style>
      <div
        ref={setContainerRef}
        data-message-scroll-container
        data-testid="runtime-next-message-scroll-container"
        style={scrollContainerStyle}
      >
        <div
          data-top-sentinel
          ref={(element) => runtime.registerTopSentinel(element)}
        />
        <div
          data-top-spacer
          style={{ height: snapshot.topSpacer }}
          ref={(element) => runtime.registerTopSpacer(element)}
        />
        <div data-message-window style={messageWindowStyle}>
          {snapshot.items.map((item) => renderProjectedRow({
            item,
            runtime,
            renderMessage,
          }))}
        </div>
        <div
          data-bottom-spacer
          style={{ height: snapshot.bottomSpacer }}
          ref={(element) => runtime.registerBottomSpacer(element)}
        />
        <div data-natural-blank style={{ height: snapshot.naturalBlankHeight }} />
        <div
          data-bottom-sentinel
          ref={(element) => runtime.registerBottomSentinel(element)}
        />
      </div>
      <RuntimeNextCustomScrollbar
        runtime={runtime}
        enabled={customScrollbar}
      />
      {bottomSlot}
      {renderTopEdge?.(snapshot)}
      {renderBottomEdge?.(snapshot)}
      {snapshot.bottomLockState === 'UNLOCKED'
        ? renderFollowBottom?.({ snapshot, followBottom })
        : null}
      {renderOverlay?.(snapshot)}
    </div>
  )
}

function renderProjectedRow<TMessage, TOptimistic>(input: {
  readonly item: MessageDataItem<TMessage, TOptimistic>
  readonly runtime: MessageViewportRuntime<TMessage, TOptimistic>
  readonly renderMessage: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
}): ReactNode {
  const key: MessageRuntimeItemKey = input.item.key
  const serializedKey = stringifyMessageRuntimeItemKey(key)

  return (
    <RuntimeNextMessageRowProjection
      key={serializedKey}
      item={input.item}
      runtime={input.runtime}
      testId={`runtime-next-message-row-${serializedKey}`}
    >
      {input.renderMessage(input.item)}
    </RuntimeNextMessageRowProjection>
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
  display: 'flow-root',
  position: 'static',
}

const runtimeNextViewportCss = `
[data-runtime-next-message-viewport] [data-message-scroll-container]::-webkit-scrollbar {
  display: none;
}
[data-runtime-next-message-viewport] [data-message-scroll-container] {
  scrollbar-width: none;
}
`
