import {
  Component,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
} from 'react'
import {
  getRuntimeItemKey,
  serializeRuntimeItemKey,
} from '../../runtime.deprecated'
import type {
  MessageDataItem,
  MessageRuntimeItemKey,
  MessageViewportRuntime,
  ViewportAnchorChangedEvent,
  MessageViewportSnapshot,
} from '../../runtime.deprecated'
import { useMessageViewportRuntime } from '../hooks/useMessageViewportRuntime'
import { CustomScrollbar } from '../scrollbar/CustomScrollbar'

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
  onViewportAnchorChange?: (event: ViewportAnchorChangedEvent) => void
  renderOverlay?: (
    snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
  ) => ReactNode
  customScrollbar?: boolean
}

type RuntimeScrollContainerProps<TMessage, TOptimistic> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  onViewportAnchorChange?: (event: ViewportAnchorChangedEvent) => void
  setContainerRef: (element: HTMLDivElement | null) => void
  children: ReactNode
}

type FollowBottomProjectionProps<TMessage, TOptimistic> = {
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>
  renderFollowBottom?: MessageViewportProps<TMessage, TOptimistic>['renderFollowBottom']
  followBottom: () => void
}

class FollowBottomProjection<
  TMessage = unknown,
  TOptimistic = unknown,
> extends Component<FollowBottomProjectionProps<TMessage, TOptimistic>> {
  render() {
    const { snapshot, renderFollowBottom, followBottom } = this.props

    const nextNode =
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

    return nextNode
  }
}

class RuntimeScrollContainer<
  TMessage = unknown,
  TOptimistic = unknown,
> extends Component<RuntimeScrollContainerProps<TMessage, TOptimistic>> {
  private unsubscribeViewportAnchorChange: (() => void) | null = null
  private subscribedViewportAnchorRuntime: MessageViewportRuntime<
    TMessage,
    TOptimistic
  > | null = null

  componentDidMount(): void {
    this.syncViewportAnchorSubscription()
  }

  getSnapshotBeforeUpdate(
    prevProps: RuntimeScrollContainerProps<TMessage, TOptimistic>,
  ): null {
    if (prevProps.runtime !== this.props.runtime) {
      prevProps.runtime.detach()
    }

    return null
  }

  componentDidUpdate(
    prevProps: RuntimeScrollContainerProps<TMessage, TOptimistic>,
  ): void {
    // React requires componentDidUpdate when getSnapshotBeforeUpdate is present.
    if (prevProps.runtime !== this.props.runtime) {
      this.clearViewportAnchorSubscription()
    }

    this.syncViewportAnchorSubscription()
  }

  componentWillUnmount(): void {
    this.props.runtime.detach()
    this.clearViewportAnchorSubscription()
  }

  private syncViewportAnchorSubscription(): void {
    if (!this.props.onViewportAnchorChange) {
      this.clearViewportAnchorSubscription()
      return
    }

    if (
      this.subscribedViewportAnchorRuntime === this.props.runtime &&
      this.unsubscribeViewportAnchorChange
    ) {
      return
    }

    this.clearViewportAnchorSubscription()
    this.subscribedViewportAnchorRuntime = this.props.runtime
    this.unsubscribeViewportAnchorChange = this.props.runtime.subscribeEvent(
      (event) => {
        if (event.type !== 'viewportAnchorChanged') {
          return
        }

        this.props.onViewportAnchorChange?.(event)
      },
    )
  }

  private clearViewportAnchorSubscription(): void {
    this.unsubscribeViewportAnchorChange?.()
    this.unsubscribeViewportAnchorChange = null
    this.subscribedViewportAnchorRuntime = null
  }

  render() {
    return (
      <div
        ref={this.props.setContainerRef}
        data-message-scroll-container
        data-testid="message-scroll-container"
        style={scrollContainerStyle}
      >
        {this.props.children}
      </div>
    )
  }
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
  customScrollbar = true,
}: MessageViewportProps<TMessage, TOptimistic>) {
  const snapshot = useMessageViewportRuntime(runtime)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(
    null,
  )
  const viewportStyle = useMemo<CSSProperties>(
    () => ({
      ...baseViewportStyle,
      ...style,
    }),
    [style],
  )
  const setContainerRef = useCallback(
    (element: HTMLDivElement | null) => {
      containerRef.current = element
      setContainerElement(element)
    },
    [],
  )

  useLayoutEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    runtime.attach(container)
  }, [runtime])
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

  return (
    <div
      className={className}
      data-message-viewport
      data-testid="message-viewport"
      data-bottom-lock-state={snapshot.bottomLockState}
      data-custom-scrollbar={customScrollbar ? 'true' : 'false'}
      style={viewportStyle}
    >
      <RuntimeScrollContainer
        runtime={runtime}
        onViewportAnchorChange={onViewportAnchorChange}
        setContainerRef={setContainerRef}
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
      </RuntimeScrollContainer>
      <CustomScrollbar
        container={containerElement}
        runtime={runtime}
        enabled={customScrollbar}
        geometryVersion={snapshot.revision}
      />
      {bottomSlot}
      {renderTopEdge?.(snapshot)}
      {renderBottomEdge?.(snapshot)}
      <FollowBottomProjection
        snapshot={snapshot}
        renderFollowBottom={renderFollowBottom}
        followBottom={followBottom}
      />
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
