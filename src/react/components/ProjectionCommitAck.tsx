import { useLayoutEffect } from 'react'
import type {
  MessageListAdapterRuntime,
  ProjectionCommitToken,
} from '../../runtime/internal'

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
