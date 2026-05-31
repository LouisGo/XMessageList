import { useCallback } from 'react'
import type { MessageListSession } from '../../index'

type RuntimeEdge = 'before' | 'after'

export function useDemoEdgeBatchLoader(input: {
  activeFeedId: string
  getSession: (feedId: string) => MessageListSession
  setLastEvent: (eventText: string) => void
}): (edge: RuntimeEdge) => void {
  const {
    activeFeedId,
    getSession,
    setLastEvent,
  } = input

  return useCallback((edge: RuntimeEdge) => {
    const session = getSession(activeFeedId)

    if (edge === 'before') {
      session.commands.loadBefore()
    } else {
      session.commands.loadAfter()
    }
    setLastEvent(`requested ${edge} messages`)
  }, [
    activeFeedId,
    getSession,
    setLastEvent,
  ])
}
