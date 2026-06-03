import type { ReactNode } from 'react'
import type {
  MessageListSessionRegistry,
} from '../../core/session-registry/index'
import { MessageListSessionRegistryContext } from './MessageListSessionRegistryContext'

export type MessageListSessionRegistryProviderProps<Row, Feed = string> = {
  registry: MessageListSessionRegistry<Row, Feed>
  children: ReactNode
}

export function MessageListSessionRegistryProvider<Row, Feed = string>({
  registry,
  children,
}: MessageListSessionRegistryProviderProps<Row, Feed>) {
  return (
    <MessageListSessionRegistryContext.Provider
      value={registry as MessageListSessionRegistry<unknown>}
    >
      {children}
    </MessageListSessionRegistryContext.Provider>
  )
}
