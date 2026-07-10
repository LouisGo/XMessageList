import type {
  MessageListRuntime,
  MessageListSnapshot,
} from '../../runtime/index'
import type {
  MessageListSessionState,
  MessageListViewState,
} from '../contracts'

const DISTANCE_TO_BOTTOM_NOTIFY_THRESHOLD_PX = 0.5

export function createMessageListSessionState<Row>(input: {
  sessionId: string
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
  let distanceToBottom = readDistanceToBottom(input.runtime)
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const unsubscribeRuntime = input.runtime.subscribeSnapshot(() => {
    cachedSnapshot = null
    notify()
  })
  const unsubscribeObservation = input.runtime.subscribeViewportObservation((event) => {
    const nextDistance = event.distanceToBottom
    if (
      Math.abs(nextDistance - distanceToBottom) <
      DISTANCE_TO_BOTTOM_NOTIFY_THRESHOLD_PX
    ) return
    distanceToBottom = nextDistance
    cachedState = null
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
      cachedState = createState(
        input.sessionId,
        snapshot,
        viewState,
        distanceToBottom,
      )
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
      unsubscribeObservation()
      listeners.clear()
    },
  }
}

function createState<Row>(
  sessionId: string,
  snapshot: MessageListSnapshot<Row>,
  viewState: MessageListViewState,
  distanceToBottom: number,
): MessageListSessionState<Row> {
  const rows = snapshot.items.map((item) => item.message as Row)

  return {
    sessionId,
    loaded: {
      rows,
      keys: snapshot.items.map((item) => item.key),
      hasMoreBefore: snapshot.segmentMeta.hasMoreBefore,
      hasMoreAfter: snapshot.segmentMeta.hasMoreAfter,
      context: snapshot.segmentMeta.context,
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

function readDistanceToBottom(runtime: MessageListRuntime<unknown>): number {
  const evidence = runtime.getEvidence()
  const distance = evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop
  return Number.isFinite(distance) ? Math.max(0, distance) : 0
}
