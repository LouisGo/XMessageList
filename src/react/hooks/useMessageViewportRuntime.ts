import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react'
import type {
  MessageViewportRuntime,
  MessageViewportSnapshot,
  RuntimeListener,
} from '../../runtime'

/**
 * React adapter 的唯一状态入口。React 在 render 阶段读取 runtime snapshot，
 * 并在 layout effect 中确认本轮 projection 已经提交到 DOM。
 */
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
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
  }, [runtime, snapshot.feedId, snapshot.generation, snapshot.revision])

  return snapshot
}
