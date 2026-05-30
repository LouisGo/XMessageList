import { useSyncExternalStore } from 'react'
import type { MessageListRuntime, MessageListSnapshot } from '../../runtime/index'

export function useMessageListSnapshot<TMessage, TOptimistic>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListSnapshot<TMessage, TOptimistic> {
  return useSyncExternalStore(
    (listener) => runtime.subscribeSnapshot(listener),
    () => runtime.getSnapshot(),
    () => runtime.getSnapshot(),
  )
}

export function useMessageListSelector<TMessage, TOptimistic, TValue>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
  selector: (snapshot: MessageListSnapshot<TMessage, TOptimistic>) => TValue,
): TValue {
  return selector(useMessageListSnapshot(runtime))
}
