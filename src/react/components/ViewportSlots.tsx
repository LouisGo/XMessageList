import { memo, type ReactNode } from 'react'
import type {
  MessageViewportRuntime,
  MessageViewportSnapshot,
  ViewportObservationChangedEvent,
} from '../../runtime'
import { useMessageViewportSelector } from '../hooks/useMessageViewportSnapshot'
import type { MessageViewportCommands, MessageViewportProps } from './types'

function selectBottomLockState(
  snapshot: MessageViewportSnapshot,
): MessageViewportSnapshot['bottomLockState'] {
  return snapshot.bottomLockState
}

function selectFullSnapshot<TMessage, TOptimistic>(
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): MessageViewportSnapshot<TMessage, TOptimistic> {
  return snapshot
}

type EdgeProjectionSlice = Pick<
  MessageViewportSnapshot,
  'feedId' | 'generation' | 'edgeState'
>

function selectEdgeProjection(snapshot: MessageViewportSnapshot): EdgeProjectionSlice {
  return {
    feedId: snapshot.feedId,
    generation: snapshot.generation,
    edgeState: snapshot.edgeState,
  }
}

function areEdgeProjectionSlicesEqual(
  previous: EdgeProjectionSlice,
  next: EdgeProjectionSlice,
): boolean {
  return (
    previous.feedId === next.feedId &&
    previous.generation === next.generation &&
    previous.edgeState.before === next.edgeState.before &&
    previous.edgeState.after === next.edgeState.after
  )
}

type FollowBottomProjectionProps<TMessage, TOptimistic> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderFollowBottom?: MessageViewportProps<
    TMessage,
    TOptimistic
  >['renderFollowBottom']
  followBottom: () => void
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
    const bottomLockState = useMessageViewportSelector(
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
    const snapshot = useMessageViewportSelector(
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

export const FollowBottomProjection = memo(
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

export const CustomEdgeProjection = memo(function CustomEdgeProjection<
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
  useMessageViewportSelector(
    runtime,
    selectEdgeProjection,
    areEdgeProjectionSlicesEqual,
  )
  const snapshot = runtime.getSnapshot()

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

export const ViewportOverlayProjection = memo(function ViewportOverlayProjection<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  runtime,
  renderViewportOverlay,
  observation,
  commands,
}: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderViewportOverlay?: MessageViewportProps<
    TMessage,
    TOptimistic
  >['renderViewportOverlay']
  observation: ViewportObservationChangedEvent | null
  commands: MessageViewportCommands
}) {
  const snapshot = useMessageViewportSelector(
    runtime,
    selectFullSnapshot,
    Object.is,
  )

  return (
    <>
      {renderViewportOverlay?.({ snapshot, observation, commands })}
    </>
  )
}) as <TMessage = unknown, TOptimistic = unknown>(props: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  renderViewportOverlay?: MessageViewportProps<
    TMessage,
    TOptimistic
  >['renderViewportOverlay']
  observation: ViewportObservationChangedEvent | null
  commands: MessageViewportCommands
}) => ReactNode
