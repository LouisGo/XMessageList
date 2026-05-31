import { useContext, useMemo } from 'react'
import type { MessageListSession } from '../../core/manager/index'
import { MessageListManagerContext } from '../components/MessageListManagerContext'

export function useMessageListSession<Row = unknown>(
  id: string,
): MessageListSession<Row> {
  const manager = useContext(MessageListManagerContext)

  if (!manager) {
    throw new Error(
      'useMessageListSession must be used within MessageListProvider.',
    )
  }

  return useMemo(
    () => manager.getSession(id) as MessageListSession<Row>,
    [id, manager],
  )
}
