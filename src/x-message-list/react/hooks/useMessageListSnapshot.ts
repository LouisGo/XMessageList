import { useSyncExternalStore } from 'react'
import type { MessageListRuntime, MessageListSnapshot } from '../../core/runtime/index'

/**
 * 通过 useSyncExternalStore 消费 runtime snapshot，确保 React 18 并发渲染下订阅语义稳定。
 */
export function useMessageListSnapshot<TMessage, TOptimistic>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListSnapshot<TMessage, TOptimistic> {
  return useSyncExternalStore(
    (listener) => runtime.subscribeSnapshot(listener),
    () => runtime.getSnapshot(),
    () => runtime.getSnapshot(),
  )
}
