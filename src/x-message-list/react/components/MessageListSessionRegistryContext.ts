import { createContext } from 'react'
import type { MessageListSessionRegistry } from '../../core/session-registry/index'

export const MessageListSessionRegistryContext =
  createContext<MessageListSessionRegistry<unknown> | null>(null)
