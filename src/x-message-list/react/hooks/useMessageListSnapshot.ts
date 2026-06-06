import type { MessageListRuntime, MessageListSnapshot } from '../../core/runtime/index'
import { useExternalStoreSource } from './useExternalStoreSource'

export function useMessageListSnapshot<TMessage, TOptimistic>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListSnapshot<TMessage, TOptimistic> {
  return useExternalStoreSource(
    runtime,
    subscribeRuntimeSnapshot,
    getRuntimeSnapshot,
  )
}

function subscribeRuntimeSnapshot<TMessage, TOptimistic>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
  listener: () => void,
): () => void {
  return runtime.subscribeSnapshot(listener)
}

function getRuntimeSnapshot<TMessage, TOptimistic>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListSnapshot<TMessage, TOptimistic> {
  return runtime.getSnapshot()
}
