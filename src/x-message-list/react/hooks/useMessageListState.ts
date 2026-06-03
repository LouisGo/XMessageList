import { useCallback } from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'
import type {
  MessageListSession,
  MessageListSessionState,
} from '../../core/manager/index'

export type MessageListStateSelector<Row, Selected> = (
  state: MessageListSessionState<Row>,
) => Selected

export type MessageListStateEqualityFn<Selected> = (
  previous: Selected,
  next: Selected,
) => boolean

export function useMessageListState<Row>(
  session: MessageListSession<Row>,
): MessageListSessionState<Row>
export function useMessageListState<Row, Selected>(
  session: MessageListSession<Row>,
  selector: MessageListStateSelector<Row, Selected>,
  equality?: MessageListStateEqualityFn<Selected>,
): Selected
export function useMessageListState<Row, Selected>(
  session: MessageListSession<Row>,
  selector?: MessageListStateSelector<Row, Selected>,
  equality?: MessageListStateEqualityFn<Selected>,
): MessageListSessionState<Row> | Selected {
  const subscribe = useCallback(
    (listener: () => void) => session.subscribe(listener),
    [session],
  )
  const getSnapshot = useCallback(
    () => session.getState(),
    [session],
  )
  const resolvedSelector = useCallback(
    (state: MessageListSessionState<Row>) =>
      selector ? selector(state) : state,
    [selector],
  )

  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getSnapshot,
    resolvedSelector,
    equality,
  )
}
