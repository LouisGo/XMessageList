import { useCallback, useSyncExternalStore } from 'react'
import type { MessageListRuntime, MessageListSnapshot } from '../../core/runtime/index'

export function useMessageListSnapshot<TMessage, TOptimistic>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListSnapshot<TMessage, TOptimistic> {
  const subscribe = useCallback(
    (listener: () => void) => runtime.subscribeSnapshot(listener),
    [runtime],
  )
  const getSnapshot = useCallback(
    () => runtime.getSnapshot(),
    [runtime],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
