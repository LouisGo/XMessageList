import { useCallback } from 'react'
import type {
  MessageListSession,
  MessageListSessionState,
} from '../../core/session-registry/index'
import { useExternalStoreSourceWithSelector } from './useExternalStoreSource'

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
  type Selection = MessageListSessionState<Row> | Selected
  const resolvedSelector = useCallback(
    (state: MessageListSessionState<Row>): Selection =>
      selector ? selector(state) : state,
    [selector],
  )
  const resolvedEquality = equality as
    | ((previous: Selection, next: Selection) => boolean)
    | undefined

  return useExternalStoreSourceWithSelector(
    session,
    subscribeSessionState,
    getSessionState,
    resolvedSelector,
    resolvedEquality,
  )
}

function subscribeSessionState<Row>(
  session: MessageListSession<Row>,
  listener: () => void,
): () => void {
  return session.subscribe(listener)
}

function getSessionState<Row>(
  session: MessageListSession<Row>,
): MessageListSessionState<Row> {
  return session.getState()
}
