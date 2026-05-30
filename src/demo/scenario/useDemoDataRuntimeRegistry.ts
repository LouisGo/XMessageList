import { useCallback, useRef } from 'react'
import {
  createMessageListDataRuntime,
  type MessageListDataRuntime,
} from '../../runtime/data/index'
import type { DemoMessage } from '../data/demoData'
import { DEMO_ITEM_BUDGET } from './demoScenarioConfig'

export function useDemoDataRuntimeRegistry() {
  const dataRuntimesRef =
    useRef(new Map<string, MessageListDataRuntime<DemoMessage>>())

  const getDataRuntime = useCallback((feedId: string) => {
    const existing = dataRuntimesRef.current.get(feedId)
    if (existing) {
      return existing
    }

    const next = createMessageListDataRuntime<DemoMessage>({
      feedId,
      itemBudget: DEMO_ITEM_BUDGET,
    })
    dataRuntimesRef.current.set(feedId, next)
    return next
  }, [])

  return { getDataRuntime }
}
