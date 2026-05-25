import { memo, type ReactNode } from 'react'
import type { MessageViewportRuntime, MessageViewportSnapshot } from '../../runtime'
import { useMessageViewportSelector } from '../hooks/useMessageViewportSnapshot'
import { CustomScrollbar } from '../scrollbar/CustomScrollbar'

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

export const CustomScrollbarBridge = memo(function CustomScrollbarBridge<
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
  const syncProjection = useMessageViewportSelector(
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
