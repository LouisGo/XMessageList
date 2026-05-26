import { useLayoutEffect } from 'react'
import type { ProjectionCommitToken } from '../runtime'
import type { MessageListAdapterRuntime } from '../runtime/internal'

export type ProjectionCommitAckProps = {
  runtime: MessageListAdapterRuntime
  token: ProjectionCommitToken
}

export function ProjectionCommitAck({
  runtime,
  token,
}: ProjectionCommitAckProps) {
  useLayoutEffect(() => {
    runtime.ackProjectionCommit(token)
  }, [runtime, token])

  return null
}
