import { memo, type ReactNode, useLayoutEffect } from 'react'
import type { MessageViewportRuntime, MessageViewportSnapshot } from '../../runtime'
import { useMessageViewportSelector } from '../hooks/useMessageViewportSnapshot'

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

export const ProjectionCommitAck = memo(function ProjectionCommitAck<
  TMessage = unknown,
  TOptimistic = unknown,
>({
  runtime,
}: {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
}) {
  const commit = useMessageViewportSelector(
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
