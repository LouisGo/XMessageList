import {
  Component,
  memo,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
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
  ViewportAnchorChangedEvent,
  MessageViewportSnapshot,
} from '../../runtime'
import { useMessageViewportRuntimeSelector } from '../hooks/useMessageViewportRuntime'
import {
  useElementRef,
  useStableCallback,
  useStableOptionalCallback,
} from '../hooks/stableState'
import { CustomScrollbar } from '../scrollbar/CustomScrollbar'

export type MessageRowProjectionProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  item: MessageDataItem<TMessage, TOptimistic>
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  children: ReactNode
  enableAiDomAttributes?: boolean
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
  enableAiDomAttributes = false,
  testId,
}: MessageRowProjectionProps<TMessage, TOptimistic>) {
  const key = getRuntimeItemKey(item)
  const serializedKey = serializeRuntimeItemKey(key)
  const messageId =
    enableAiDomAttributes && key.kind === 'committed'
      ? key.messageId
      : undefined
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

export type MessageViewportProps<
  TMessage = unknown,
  TOptimistic = unknown,
> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderMessage: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  /**
   * Optional explicit invalidation for row output that depends on external
   * UI state outside the MessageDataItem. When provided, row memoization uses
   * this value instead of renderMessage function identity.
   */
  getRowRenderVersion?: (
    item: MessageDataItem<TMessage, TOptimistic>,
  ) => unknown
  className?: string
  aiRegion?: string
  enableAiDomAttributes?: boolean
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
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderFollowBottom?: MessageViewportProps<TMessage, TOptimistic>['renderFollowBottom']
  followBottom: () => void
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

type ProjectionCommitSlice = Pick<
  MessageViewportSnapshot,
  'feedId' | 'generation' | 'revision'
>

function selectProjectionCommit(
  snapshot: MessageViewportSnapshot,
): ProjectionCommitSlice {
  return {
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    revision: snapshot.revision,
  }
}

function areProjectionCommitSlicesEqual(
  previous: ProjectionCommitSlice,
  next: ProjectionCommitSlice,
): boolean {
  return (
    previous.feedId === next.feedId &&
    previous.generation === next.generation &&
    previous.revision === next.revision
  )
}

const ProjectionCommitAck = memo(function ProjectionCommitAck<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  runtime,
}: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
}) {
  const commit = useMessageViewportRuntimeSelector(
    runtime,
    selectProjectionCommit,
    areProjectionCommitSlicesEqual,
  )

  useLayoutEffect(() => {
    runtime.notifyProjectionCommitted(commit)
  }, [commit, runtime])

  return null
}) as <TMessage = unknown, TOptimistic = unknown>(props: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
}) => ReactNode

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

type MessageWindowProjectionProps<TMessage, TOptimistic> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderMessage: (item: MessageDataItem<TMessage, TOptimistic>) => ReactNode
  getRowRenderVersion?: MessageViewportProps<
    TMessage,
    TOptimistic
  >['getRowRenderVersion']
  enableAiDomAttributes?: boolean
}

type MessageRowsProjectionProps<TMessage, TOptimistic> =
  MessageWindowProjectionProps<TMessage, TOptimistic> & {
    items: Array<MessageDataItem<TMessage, TOptimistic>>
  }

const MessageRowsProjection = memo(
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
  return (
    previous.items === next.items &&
    areMessageWindowProjectionPropsEqual(previous, next)
  )
}

const MessageWindowProjection = memo(
  function MessageWindowProjection<TMessage = unknown, TOptimistic = unknown>({
    runtime,
    renderMessage,
    getRowRenderVersion,
    enableAiDomAttributes = false,
  }: MessageWindowProjectionProps<TMessage, TOptimistic>) {
    const windowProjection = useMessageViewportRuntimeSelector(
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

function selectBottomLockState(
  snapshot: MessageViewportSnapshot,
): MessageViewportSnapshot['bottomLockState'] {
  return snapshot.bottomLockState
}

type ScrollbarProjectionSyncSlice = Pick<
  MessageViewportSnapshot,
  'feedId' | 'generation' | 'revision'
>

function selectScrollbarProjectionSync(
  snapshot: MessageViewportSnapshot,
): ScrollbarProjectionSyncSlice {
  return {
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    revision: snapshot.revision,
  }
}

function areScrollbarProjectionSyncSlicesEqual(
  previous: ScrollbarProjectionSyncSlice,
  next: ScrollbarProjectionSyncSlice,
): boolean {
  return (
    previous.feedId === next.feedId &&
    previous.generation === next.generation &&
    previous.revision === next.revision
  )
}

const CustomScrollbarBridge = memo(function CustomScrollbarBridge<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  container,
  runtime,
  enabled,
}: {
  container: HTMLElement | null
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  enabled: boolean
}) {
  const syncProjection = useMessageViewportRuntimeSelector(
    runtime,
    selectScrollbarProjectionSync,
    areScrollbarProjectionSyncSlicesEqual,
  )

  return (
    <CustomScrollbar
      container={container}
      runtime={runtime}
      enabled={enabled}
      geometryVersion={syncProjection.revision}
    />
  )
}) as <TMessage = unknown, TOptimistic = unknown>(props: {
  container: HTMLElement | null
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  enabled: boolean
}) => ReactNode

function selectFullSnapshot<TMessage, TOptimistic>(
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): MessageViewportSnapshot<TMessage, TOptimistic> {
  return snapshot
}

const DefaultFollowBottomProjection = memo(
  function DefaultFollowBottomProjection<
    TMessage = unknown,
    TOptimistic = unknown,
  >({
    runtime,
    followBottom,
  }: Omit<
    FollowBottomProjectionProps<TMessage, TOptimistic>,
    'renderFollowBottom'
  >) {
    const bottomLockState = useMessageViewportRuntimeSelector(
      runtime,
      selectBottomLockState,
      Object.is,
    )

    if (bottomLockState !== 'UNLOCKED') {
      return null
    }

    return (
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
  },
) as <TMessage = unknown, TOptimistic = unknown>(
  props: Omit<
    FollowBottomProjectionProps<TMessage, TOptimistic>,
    'renderFollowBottom'
  >,
) => ReactNode

const CustomFollowBottomProjection = memo(
  function CustomFollowBottomProjection<
    TMessage = unknown,
    TOptimistic = unknown,
  >({
    runtime,
    renderFollowBottom,
    followBottom,
  }: Required<FollowBottomProjectionProps<TMessage, TOptimistic>>) {
    const snapshot = useMessageViewportRuntimeSelector(
      runtime,
      selectFullSnapshot,
      Object.is,
    )

    if (snapshot.bottomLockState !== 'UNLOCKED') {
      return null
    }

    return <>{renderFollowBottom({ snapshot, followBottom })}</>
  },
) as <TMessage = unknown, TOptimistic = unknown>(
  props: Required<FollowBottomProjectionProps<TMessage, TOptimistic>>,
) => ReactNode

const FollowBottomProjection = memo(
  function FollowBottomProjection<TMessage = unknown, TOptimistic = unknown>({
    runtime,
    renderFollowBottom,
    followBottom,
  }: FollowBottomProjectionProps<TMessage, TOptimistic>) {
    if (renderFollowBottom) {
      return (
        <CustomFollowBottomProjection
          runtime={runtime}
          renderFollowBottom={renderFollowBottom}
          followBottom={followBottom}
        />
      )
    }

    return (
      <DefaultFollowBottomProjection
        runtime={runtime}
        followBottom={followBottom}
      />
    )
  },
) as <TMessage = unknown, TOptimistic = unknown>(
  props: FollowBottomProjectionProps<TMessage, TOptimistic>,
) => ReactNode

const CustomEdgeProjection = memo(function CustomEdgeProjection<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  runtime,
  renderTopEdge,
  renderBottomEdge,
}: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderTopEdge?: MessageViewportProps<TMessage, TOptimistic>['renderTopEdge']
  renderBottomEdge?: MessageViewportProps<
    TMessage,
    TOptimistic
  >['renderBottomEdge']
}) {
  const snapshot = useMessageViewportRuntimeSelector(
    runtime,
    selectFullSnapshot,
    Object.is,
  )

  return (
    <>
      {renderTopEdge?.(snapshot)}
      {renderBottomEdge?.(snapshot)}
    </>
  )
}) as <TMessage = unknown, TOptimistic = unknown>(props: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderTopEdge?: MessageViewportProps<TMessage, TOptimistic>['renderTopEdge']
  renderBottomEdge?: MessageViewportProps<
    TMessage,
    TOptimistic
  >['renderBottomEdge']
}) => ReactNode

const CustomOverlayProjection = memo(function CustomOverlayProjection<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  runtime,
  renderOverlay,
}: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderOverlay: MessageViewportProps<TMessage, TOptimistic>['renderOverlay']
}) {
  const snapshot = useMessageViewportRuntimeSelector(
    runtime,
    selectFullSnapshot,
    Object.is,
  )

  return <>{renderOverlay?.(snapshot)}</>
}) as <TMessage = unknown, TOptimistic = unknown>(props: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderOverlay: MessageViewportProps<TMessage, TOptimistic>['renderOverlay']
}) => ReactNode

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
  getRowRenderVersion,
  className,
  aiRegion,
  enableAiDomAttributes = false,
  style,
  bottomSlot,
  renderTopEdge,
  renderBottomEdge,
  renderFollowBottom,
  onViewportAnchorChange,
  renderOverlay,
  customScrollbar = true,
}: MessageViewportProps<TMessage, TOptimistic>) {
  const bottomLockState = useMessageViewportRuntimeSelector(
    runtime,
    selectBottomLockState,
    Object.is,
  )
  const [containerRef, containerElement, setContainerRef] =
    useElementRef<HTMLDivElement>()
  const viewportStyle = useMemo<CSSProperties>(
    () => ({
      ...baseViewportStyle,
      ...style,
    }),
    [style],
  )
  const stableOnViewportAnchorChange = useStableOptionalCallback(
    onViewportAnchorChange,
  )

  useLayoutEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    runtime.attach(container)
  }, [containerRef, runtime])
  const followBottom = useStableCallback(() => {
    runtime.dispatch({ type: 'followBottom' })
  })

  return (
    <div
      className={className}
      data-message-viewport
      data-testid="message-viewport"
      data-ai-region={aiRegion}
      data-bottom-lock-state={bottomLockState}
      data-custom-scrollbar={customScrollbar ? 'true' : 'false'}
      style={viewportStyle}
    >
      <ProjectionCommitAck runtime={runtime} />
      <RuntimeScrollContainer
        runtime={runtime}
        onViewportAnchorChange={stableOnViewportAnchorChange}
        setContainerRef={setContainerRef}
      >
        <MessageWindowProjection
          runtime={runtime}
          renderMessage={renderMessage}
          getRowRenderVersion={getRowRenderVersion}
          enableAiDomAttributes={enableAiDomAttributes}
        />
      </RuntimeScrollContainer>
      {customScrollbar && (
        <CustomScrollbarBridge
          container={containerElement}
          runtime={runtime}
          enabled
        />
      )}
      {bottomSlot}
      {(renderTopEdge || renderBottomEdge) && (
        <CustomEdgeProjection
          runtime={runtime}
          renderTopEdge={renderTopEdge}
          renderBottomEdge={renderBottomEdge}
        />
      )}
      <FollowBottomProjection
        runtime={runtime}
        renderFollowBottom={renderFollowBottom}
        followBottom={followBottom}
      />
      {renderOverlay && (
        <CustomOverlayProjection
          runtime={runtime}
          renderOverlay={renderOverlay}
        />
      )}
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
