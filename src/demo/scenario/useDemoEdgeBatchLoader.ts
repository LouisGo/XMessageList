import { useCallback } from 'react'
import { toDemoMessageDataItem } from '../demoData'
import { loadDemoFeedMessages } from '../demoMessageApi'
import { waitMockDelay } from './demoScenarioHelpers'
import type {
  DemoDataRuntimeGetter,
  DemoSegmentPublisher,
} from './demoScenarioTypes'

type RuntimeEdge = 'before' | 'after'

export function useDemoEdgeBatchLoader(input: {
  activeFeedId: string
  getDataRuntime: DemoDataRuntimeGetter
  loadingDelayBaseMs: number
  pageSize: number
  publishSegment: DemoSegmentPublisher
  setEdgeLoading: (edge: RuntimeEdge, loading: boolean) => void
  setLastEvent: (eventText: string) => void
  setMessageCount: (messageCount: number) => void
}): (edge: RuntimeEdge) => void {
  const {
    activeFeedId,
    getDataRuntime,
    loadingDelayBaseMs,
    pageSize,
    publishSegment,
    setEdgeLoading,
    setLastEvent,
    setMessageCount,
  } = input

  return useCallback((edge: RuntimeEdge) => {
    const dataRuntime = getDataRuntime(activeFeedId)
    const segment = dataRuntime.getSegment()
    const boundaryItem = edge === 'before'
      ? segment.items[0]
      : segment.items.at(-1)
    const boundaryMessage = boundaryItem?.message

    if (!boundaryMessage) {
      setLastEvent(`no ${edge} boundary loaded`)
      return
    }

    setEdgeLoading(edge, true)
    void (async () => {
      try {
        await waitMockDelay(loadingDelayBaseMs)
        const allMessages = await loadDemoFeedMessages(activeFeedId)
        const boundaryIndex = allMessages.findIndex((message) =>
          message.id === boundaryMessage.id
        )

        if (boundaryIndex < 0) {
          setLastEvent(`${edge} boundary missing from mock store`)
          return
        }

        const request = dataRuntime.createRequestToken(edge)
        const start = edge === 'before'
          ? Math.max(0, boundaryIndex - pageSize)
          : boundaryIndex + 1
        const end = edge === 'before'
          ? boundaryIndex
          : Math.min(allMessages.length, boundaryIndex + 1 + pageSize)
        const incoming = allMessages.slice(start, end)
        const applyInput = {
          requestToken: request.requestToken,
          items: incoming.map(toDemoMessageDataItem),
          hasMoreBefore: edge === 'before' ? start > 0 : segment.hasMoreBefore,
          hasMoreAfter: edge === 'after'
            ? end < allMessages.length
            : segment.hasMoreAfter,
          anchor: segment.anchor,
          anchorStatus: segment.anchorStatus,
        }
        const result = edge === 'before'
          ? dataRuntime.extendBefore(applyInput)
          : dataRuntime.extendAfter(applyInput)

        if (result.applied) {
          publishSegment(dataRuntime)
          setMessageCount(allMessages.length)
          setLastEvent(`manually loaded ${incoming.length} ${edge} messages`)
          return
        }

        setLastEvent(`ignored stale manual ${edge} response`)
      } finally {
        setEdgeLoading(edge, false)
      }
    })()
  }, [
    activeFeedId,
    getDataRuntime,
    loadingDelayBaseMs,
    pageSize,
    publishSegment,
    setEdgeLoading,
    setLastEvent,
    setMessageCount,
  ])
}
