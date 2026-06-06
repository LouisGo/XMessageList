import { useCallback, useSyncExternalStore } from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'

type StoreUnsubscribe = () => void

export function useExternalStoreSource<TSource, TSnapshot>(
  source: TSource,
  subscribeSource: (
    source: TSource,
    listener: () => void,
  ) => StoreUnsubscribe,
  getSourceSnapshot: (source: TSource) => TSnapshot,
): TSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeSource(source, listener),
    [source, subscribeSource],
  )
  const getSnapshot = useCallback(
    () => getSourceSnapshot(source),
    [source, getSourceSnapshot],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useExternalStoreSourceWithSelector<
  TSource,
  TSnapshot,
  TSelected,
>(
  source: TSource,
  subscribeSource: (
    source: TSource,
    listener: () => void,
  ) => StoreUnsubscribe,
  getSourceSnapshot: (source: TSource) => TSnapshot,
  selector: (snapshot: TSnapshot) => TSelected,
  equality?: (previous: TSelected, next: TSelected) => boolean,
): TSelected {
  const subscribe = useCallback(
    (listener: () => void) => subscribeSource(source, listener),
    [source, subscribeSource],
  )
  const getSnapshot = useCallback(
    () => getSourceSnapshot(source),
    [source, getSourceSnapshot],
  )

  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getSnapshot,
    selector,
    equality,
  )
}
