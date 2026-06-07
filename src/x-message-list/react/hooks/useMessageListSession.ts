import { useContext, useMemo } from 'react'
import type {
  MessageListSession,
  MessageListSessionId,
} from '../../core/session-registry/index'
import { MessageListSessionRegistryContext } from '../components/MessageListSessionRegistryContext'

/** 从最近的 MessageListSessionRegistryProvider 中按 sessionId 获取 session。 */
export function useMessageListSession<Row = unknown>(
  sessionId: MessageListSessionId,
): MessageListSession<Row> {
  const registry = useContext(MessageListSessionRegistryContext)

  if (!registry) {
    throw new Error(
      'useMessageListSession must be used within MessageListSessionRegistryProvider.',
    )
  }

  return useMemo(
    () => registry.getSession(sessionId) as MessageListSession<Row>,
    [sessionId, registry],
  )
}
