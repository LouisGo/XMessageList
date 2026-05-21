import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react'
import type { MessageViewportRuntime } from '../MessageViewportRuntime'
import type {
  MessageViewportSnapshot,
  PhysicalScrollMetrics,
  RuntimeListener,
} from '../types'

export function useMessageViewportRuntime<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  runtime: MessageViewportRuntime<TMessage, TOptimistic>,
): MessageViewportSnapshot<TMessage, TOptimistic> {
  const subscribe = useCallback(
    (listener: RuntimeListener) => runtime.subscribe(listener),
    [runtime],
  )
  const getSnapshot = useCallback(() => runtime.getSnapshot(), [runtime])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useLayoutEffect(() => {
    runtime.notifyProjectionCommitted(snapshot.commitToken)
  }, [runtime, snapshot.commitToken])

  return snapshot
}

export function usePhysicalScrollMetrics(
  runtime: MessageViewportRuntime,
): PhysicalScrollMetrics {
  const subscribe = useCallback(
    (listener: RuntimeListener) => runtime.subscribePhysicalScroll(listener),
    [runtime],
  )
  const getSnapshot = useCallback(
    () => runtime.getPhysicalScrollMetrics(),
    [runtime],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
