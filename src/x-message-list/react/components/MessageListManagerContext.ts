import { createContext } from 'react'
import type { MessageListSessionRegistry } from '../../core/manager/index'

export const MessageListSessionRegistryContext =
  createContext<MessageListSessionRegistry<unknown> | null>(null)

/** @deprecated Use MessageListSessionRegistryContext. */
export const MessageListManagerContext = MessageListSessionRegistryContext
