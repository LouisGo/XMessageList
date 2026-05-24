import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type {
  MessageViewportRuntime,
  MessageViewportSnapshot,
  RuntimeListener,
} from '../../runtime'

type SnapshotSelector<TMessage, TOptimistic, TSelected> = (
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
) => TSelected

type SnapshotSelectionCache<TMessage, TOptimistic, TSelected> = {
  runtime: MessageViewportRuntime<TMessage, TOptimistic>
  source: MessageViewportSnapshot<TMessage, TOptimistic>
  selector: SnapshotSelector<TMessage, TOptimistic, TSelected>
  selected: TSelected
}

export function useMessageViewportRuntimeSelector<
  TMessage = unknown,
  TOptimistic = unknown,
  TSelected = MessageViewportSnapshot<TMessage, TOptimistic>,
>(
  runtime: MessageViewportRuntime<TMessage, TOptimistic>,
  selector: SnapshotSelector<TMessage, TOptimistic, TSelected>,
  isEqual: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  const cacheRef =
    useRef<SnapshotSelectionCache<TMessage, TOptimistic, TSelected> | null>(null)
  const subscribe = useCallback(
    (listener: RuntimeListener) => runtime.subscribe(listener),
    [runtime],
  )
  const getSelectedSnapshot = useCallback(() => {
    const source = runtime.getSnapshot()
    const cache = cacheRef.current

    if (
      cache &&
      cache.runtime === runtime &&
      cache.source === source &&
      cache.selector === selector
    ) {
      return cache.selected
    }

    const selected = selector(source)

    if (
      cache &&
      cache.runtime === runtime &&
      isEqual(cache.selected, selected)
    ) {
      cacheRef.current = {
        runtime,
        source,
        selector,
        selected: cache.selected,
      }
      return cache.selected
    }

    cacheRef.current = {
      runtime,
      source,
      selector,
      selected,
    }
    return selected
  }, [isEqual, runtime, selector])

  return useSyncExternalStore(
    subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot,
  )
}

function selectFullSnapshot<TMessage, TOptimistic>(
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): MessageViewportSnapshot<TMessage, TOptimistic> {
  return snapshot
}

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
  const snapshot = useMessageViewportRuntimeSelector(
    runtime,
    selectFullSnapshot,
    Object.is,
  )

  useLayoutEffect(() => {
    runtime.notifyProjectionCommitted({
      feedId: snapshot.feedId,
      generation: snapshot.generation,
      revision: snapshot.revision,
    })
  }, [runtime, snapshot.feedId, snapshot.generation, snapshot.revision])

  return snapshot
}
