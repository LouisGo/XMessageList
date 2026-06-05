import { useContext, useMemo } from 'react'
import type {
  MessageListSession,
  MessageListSessionId,
} from '../../core/session-registry/index'
import { MessageListSessionRegistryContext } from '../components/MessageListSessionRegistryContext'

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
