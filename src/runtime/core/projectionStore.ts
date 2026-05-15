import type {
  MessageViewportSnapshot,
  RuntimeListener,
  ViewportEdgeState,
} from '../types'

const EMPTY_EDGE_STATE: ViewportEdgeState = {
  before: 'idle',
  after: 'idle',
}

export function createEmptySnapshot<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  feedId = '',
  generation = 0,
): MessageViewportSnapshot<TMessage, TOptimistic> {
  return {
    feedId,
    generation,
    revision: 0,
    items: [],
    renderWindow: {
      startIndex: 0,
      endIndex: -1,
      itemKeys: [],
    },
    topSpacer: 0,
    bottomSpacer: 0,
    bottomLockState: 'UNLOCKED',
    bootstrapState: 'INITIAL',
    edgeState: EMPTY_EDGE_STATE,
  }
}

/**
 * ProjectionStore 是 React external store 的唯一来源。
 * 它只在 snapshot 对象真实替换时通知订阅者，保证 useSyncExternalStore
 * 在未变化时读到同一个对象引用。
 */
export class ProjectionStore<TMessage = unknown, TOptimistic = unknown> {
  private snapshot: MessageViewportSnapshot<TMessage, TOptimistic>

  private readonly listeners = new Set<RuntimeListener>()

  constructor(initialSnapshot = createEmptySnapshot<TMessage, TOptimistic>()) {
    this.snapshot = initialSnapshot
  }

  getSnapshot(): MessageViewportSnapshot<TMessage, TOptimistic> {
    return this.snapshot
  }

  setSnapshot(snapshot: MessageViewportSnapshot<TMessage, TOptimistic>): void {
    if (Object.is(snapshot, this.snapshot)) {
      return
    }

    this.snapshot = snapshot
    for (const listener of this.listeners) {
      listener()
    }
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  clearListeners(): void {
    this.listeners.clear()
  }
}
