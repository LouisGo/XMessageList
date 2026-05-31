import { useContext, useMemo } from 'react'
import type { MessageListController } from '../../manager/index'
import { MessageListManagerContext } from '../components/MessageListManagerContext'

export function useMessageListController<Row = unknown>(
  id: string,
): MessageListController<Row> {
  const manager = useContext(MessageListManagerContext)

  if (!manager) {
    throw new Error(
      'useMessageListController must be used within MessageListProvider.',
    )
  }

  return useMemo(
    () => manager.getController(id) as MessageListController<Row>,
    [id, manager],
  )
}
