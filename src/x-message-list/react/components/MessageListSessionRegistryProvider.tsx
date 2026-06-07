import type { ReactNode } from 'react'
import type {
  MessageListSessionSource,
  MessageListSessionRegistry,
} from '../../core/session-registry/index'
import { MessageListSessionRegistryContext } from './MessageListSessionRegistryContext'

/** MessageListSessionRegistryProvider props。 */
export type MessageListSessionRegistryProviderProps<
  Row,
  Source = MessageListSessionSource,
> = {
  /** 提供给子组件的 session registry。 */
  registry: MessageListSessionRegistry<Row, Source>
  /** 可以调用 useMessageListSession 的子树。 */
  children: ReactNode
}

/** 为子组件提供 MessageListSessionRegistry context。 */
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
