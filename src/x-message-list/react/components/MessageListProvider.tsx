import type { ReactNode } from 'react'
import type {
  MessageListManager,
} from '../../core/manager/index'
import { MessageListManagerContext } from './MessageListManagerContext'

export type MessageListProviderProps<Row> = {
  manager: MessageListManager<Row>
  children: ReactNode
}

export function MessageListProvider<Row>({
  manager,
  children,
}: MessageListProviderProps<Row>) {
  return (
    <MessageListManagerContext.Provider
      value={manager as MessageListManager<unknown>}
    >
      {children}
    </MessageListManagerContext.Provider>
  )
}
