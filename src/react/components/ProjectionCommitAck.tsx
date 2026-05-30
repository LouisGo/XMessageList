import { useLayoutEffect } from 'react'
import type {
  MessageListAdapterRuntime,
  ProjectionCommitToken,
} from '../../runtime/internal'

export type ProjectionCommitAckProps = {
  runtime: MessageListAdapterRuntime
  token: ProjectionCommitToken
}

/**
 * 在 React layout commit 后通知 runtime：当前 ProjectionCommitToken 对应的 DOM 已可测量。
 */
export function ProjectionCommitAck({
  runtime,
  token,
}: ProjectionCommitAckProps) {
  useLayoutEffect(() => {
    runtime.ackProjectionCommit(token)
  }, [runtime, token])

  return null
}
