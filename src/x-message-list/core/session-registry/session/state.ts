import type {
  MessageListRuntime,
  MessageListSnapshot,
} from '../../runtime/index'
import type {
  MessageListSessionState,
  MessageListViewState,
} from '../contracts'

export function createMessageListSessionState<Row>(input: {
  id: string
  runtime: MessageListRuntime<Row>
  getViewState: () => MessageListViewState
}): {
  getState: () => MessageListSessionState<Row>
  subscribe: (listener: () => void) => () => void
  notifyViewChanged: () => void
  destroy: () => void
} {
  const listeners = new Set<() => void>()
  let cachedSnapshot: MessageListSnapshot<Row> | null = null
  let cachedViewState: MessageListViewState | null = null
  let cachedState: MessageListSessionState<Row> | null = null
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const unsubscribeRuntime = input.runtime.subscribeSnapshot(() => {
    cachedSnapshot = null
    notify()
  })

  return {
    getState: () => {
      const snapshot = input.runtime.getSnapshot()
      const viewState = input.getViewState()

      if (
        cachedState &&
        cachedSnapshot === snapshot &&
        cachedViewState === viewState
      ) {
        return cachedState
      }

      cachedSnapshot = snapshot
      cachedViewState = viewState
      cachedState = createState(input.id, snapshot, viewState, input.runtime)
      return cachedState
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notifyViewChanged: () => {
      cachedViewState = null
      notify()
    },
    destroy: () => {
      unsubscribeRuntime()
      listeners.clear()
    },
  }
}

function createState<Row>(
  id: string,
  snapshot: MessageListSnapshot<Row>,
  viewState: MessageListViewState,
  runtime: MessageListRuntime<Row>,
): MessageListSessionState<Row> {
  const evidence = runtime.getEvidence()
  const distanceToBottom = Math.max(
    0,
    evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop,
  )
  const rows = snapshot.items.map((item) => item.message as Row)

  return {
    id,
    sessionId: id,
    feedId: snapshot.feedId,
    loaded: {
      rows,
      keys: snapshot.items.map((item) => item.key),
      hasMoreBefore: snapshot.segmentMeta.hasMoreBefore,
      hasMoreAfter: snapshot.segmentMeta.hasMoreAfter,
    },
    edge: {
      before: { status: snapshot.edgeState.before.status },
      after: { status: snapshot.edgeState.after.status },
    },
    overlayStatus: viewState.overlayStatus,
    viewport: {
      bottomLockState: snapshot.bottomLockState,
      pendingIntent: snapshot.pendingIntent,
      phase: snapshot.viewportPhase,
      distanceToBottom,
    },
  }
}
