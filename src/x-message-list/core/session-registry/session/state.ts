import type {
  LoadedSegment,
  MessageListRuntime,
  MessageListSnapshot,
} from '../../runtime/index'
import type {
  MessageListDestinationState,
  MessageListSessionState,
  MessageListViewState,
} from '../contracts'

const DISTANCE_TO_BOTTOM_NOTIFY_THRESHOLD_PX = 0.5

export function createMessageListSessionState<Row>(input: {
  sessionId: string
  runtime: MessageListRuntime<Row>
  /** reload stage 期间仍返回最后一个完整 settle 的 authoritative segment。 */
  getCommittedSegment: () => LoadedSegment<Row>
  getViewState: () => MessageListViewState
  getDestinationState: () => MessageListDestinationState
}): {
  getState: () => MessageListSessionState<Row>
  subscribe: (listener: () => void) => () => void
  notifyViewChanged: () => void
  notifyLoadedChanged: () => void
  notifyDestinationChanged: () => void
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
        input.getCommittedSegment(),
        viewState,
        distanceToBottom,
        input.getDestinationState(),
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
    notifyLoadedChanged: () => {
      cachedState = null
      notify()
    },
    notifyDestinationChanged: () => {
      cachedState = null
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
  committed: LoadedSegment<Row>,
  viewState: MessageListViewState,
  distanceToBottom: number,
  destination: MessageListDestinationState,
): MessageListSessionState<Row> {
  const rows = committed.items.map((item) => item.message as Row)

  return {
    sessionId,
    loaded: {
      rows,
      keys: committed.items.map((item) => item.key),
      hasMoreBefore: committed.hasMoreBefore,
      hasMoreAfter: committed.hasMoreAfter,
      context: committed.context,
    },
    edge: {
      before: { status: snapshot.edgeState.before.status },
      after: { status: snapshot.edgeState.after.status },
    },
    overlayStatus: viewState.overlayStatus,
    destination,
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
