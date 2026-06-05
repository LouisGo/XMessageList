import type { ReactNode } from 'react'
import type {
  MessageListSessionSource,
  MessageListSessionRegistry,
} from '../../core/session-registry/index'
import { MessageListSessionRegistryContext } from './MessageListSessionRegistryContext'

export type MessageListSessionRegistryProviderProps<
  Row,
  Source = MessageListSessionSource,
> = {
  registry: MessageListSessionRegistry<Row, Source>
  children: ReactNode
}

export function MessageListSessionRegistryProvider<
  Row,
  Source = MessageListSessionSource,
>({
  registry,
  children,
}: MessageListSessionRegistryProviderProps<Row, Source>) {
  return (
    <MessageListSessionRegistryContext.Provider
      value={registry as MessageListSessionRegistry<unknown>}
    >
      {children}
    </MessageListSessionRegistryContext.Provider>
  )
}
