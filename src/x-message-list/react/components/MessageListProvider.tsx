import type { ReactNode } from 'react'
import type {
  MessageListManager,
  MessageListSessionRegistry,
} from '../../core/manager/index'
import { MessageListSessionRegistryContext } from './MessageListManagerContext'

export type MessageListProviderProps<Row> = {
  /** @deprecated Use registry. */
  manager: MessageListManager<Row>
  children: ReactNode
}

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

/** @deprecated Use MessageListSessionRegistryProvider. */
export function MessageListProvider<Row>({
  manager,
  children,
}: MessageListProviderProps<Row>) {
  return (
    <MessageListSessionRegistryProvider registry={manager}>
      {children}
    </MessageListSessionRegistryProvider>
  )
}
