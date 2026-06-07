import { useCallback } from 'react'
import type {
  MessageListSession,
  MessageListSessionState,
} from '../../core/session-registry/index'
import { useExternalStoreSourceWithSelector } from './useExternalStoreSource'

/** 从 session state 中选择组件需要的子状态。 */
export type MessageListStateSelector<Row, Selected> = (
  state: MessageListSessionState<Row>,
) => Selected

/** 判断两次 selector 结果是否相等；相等时跳过 React 更新。 */
export type MessageListStateEqualityFn<Selected> = (
  previous: Selected,
  next: Selected,
) => boolean

/** 订阅整个 MessageList session state。 */
export function useMessageListState<Row>(
  session: MessageListSession<Row>,
): MessageListSessionState<Row>
/** 订阅 MessageList session state 的 selector 结果；equality 未传时使用 Object.is 语义。 */
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
