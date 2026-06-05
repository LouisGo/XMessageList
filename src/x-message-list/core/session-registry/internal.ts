import type {
  MessageDataItem,
  MessageListRuntime,
  MessageListSnapshot,
} from '../runtime/index'
import type { LoadedSegmentStore } from './loaded-segment-store/index'
import type {
  MessageListSession,
  MessageListViewState,
} from './contracts'

const MESSAGE_LIST_SESSION_INTERNALS: unique symbol =
  Symbol('MessageListSessionInternals')

export type MessageListSessionInternals<Row = unknown> = {
  runtime: MessageListRuntime<Row>
  loadedSegmentStore: LoadedSegmentStore<Row>
  getSnapshot(): MessageListSnapshot<Row>
  getViewState(): MessageListViewState
  subscribeView(listener: () => void): () => void
  retainView(): () => void
  getRow(item: MessageDataItem<Row>): Row | null
  getRowRenderVersion(item: MessageDataItem<Row>): unknown
  getRowsByKeys(keys: string[]): Row[]
}

type MessageListSessionInternalCarrier<Row> = MessageListSession<Row> & {
  [MESSAGE_LIST_SESSION_INTERNALS]?: MessageListSessionInternals<Row>
}

export function defineMessageListSessionInternals<Row>(
  session: MessageListSession<Row>,
  internals: MessageListSessionInternals<Row>,
): void {
  Object.defineProperty(session, MESSAGE_LIST_SESSION_INTERNALS, {
    configurable: false,
    enumerable: false,
    value: internals,
  })
}

export function getMessageListSessionInternals<Row>(
  session: MessageListSession<Row>,
): MessageListSessionInternals<Row> {
  const internals =
    (session as MessageListSessionInternalCarrier<Row>)[MESSAGE_LIST_SESSION_INTERNALS]

  if (!internals) {
    throw new Error('Invalid MessageListSession: missing internal runtime handle.')
  }

  return internals
}
