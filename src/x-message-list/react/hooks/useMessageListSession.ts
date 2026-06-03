import { useContext, useMemo } from 'react'
import type {
  MessageListSession,
  MessageListSessionId,
} from '../../core/session-registry/index'
import { MessageListSessionRegistryContext } from '../components/MessageListSessionRegistryContext'

export function useMessageListSession<Row = unknown>(
  id: MessageListSessionId,
): MessageListSession<Row> {
  const registry = useContext(MessageListSessionRegistryContext)

  if (!registry) {
    throw new Error(
      'useMessageListSession must be used within MessageListSessionRegistryProvider.',
    )
  }

  return useMemo(
    () => registry.getSession(id) as MessageListSession<Row>,
    [id, registry],
  )
}
