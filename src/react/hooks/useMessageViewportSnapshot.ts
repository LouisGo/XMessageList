import { useCallback, useRef, useSyncExternalStore } from 'react'
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

function useMessageViewportBaseSelector<
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

export function useMessageViewportSelector<
  TMessage = unknown,
  TOptimistic = unknown,
  TSelected = MessageViewportSnapshot<TMessage, TOptimistic>,
>(
  runtime: MessageViewportRuntime<TMessage, TOptimistic>,
  selector: SnapshotSelector<TMessage, TOptimistic, TSelected>,
  isEqual: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  return useMessageViewportBaseSelector(runtime, selector, isEqual)
}

function selectFullSnapshot<TMessage, TOptimistic>(
  snapshot: MessageViewportSnapshot<TMessage, TOptimistic>,
): MessageViewportSnapshot<TMessage, TOptimistic> {
  return snapshot
}

export function useMessageViewportSnapshot<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  runtime: MessageViewportRuntime<TMessage, TOptimistic>,
): MessageViewportSnapshot<TMessage, TOptimistic> {
  return useMessageViewportSelector(
    runtime,
    selectFullSnapshot,
    Object.is,
  )
}
