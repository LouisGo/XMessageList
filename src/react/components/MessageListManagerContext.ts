import { createContext } from 'react'
import type { MessageListManager } from '../../manager/index'

export const MessageListManagerContext =
  createContext<MessageListManager<unknown> | null>(null)
