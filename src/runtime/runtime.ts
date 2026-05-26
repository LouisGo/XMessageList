import type { MessageIdentityAnchor } from './identity'
import type { MessageListRuntimeEventListener } from './events'
import type { LoadedSegment } from './segment'
import type {
  MessageListRestoreOptions,
  MessageListRuntimeOptions,
  MessageListScrollOptions,
  MessageListScrollToMessageOptions,
} from './options'
import type {
  MessageListSnapshot,
  MessageListSnapshotListener,
  ViewportEvidence,
} from './snapshot'

export type MessageListRuntime<TMessage = unknown, TOptimistic = unknown> = {
  attachScrollContainer(container: HTMLElement): void
  detachScrollContainer(): void
  destroy(): void
  applyLoadedSegment(segment: LoadedSegment<TMessage, TOptimistic>): void
  scrollToLatest(options?: MessageListScrollOptions): void
  scrollToMessage(
    target: MessageIdentityAnchor,
    options?: MessageListScrollToMessageOptions,
  ): void
  restoreToMessage(
    target: MessageIdentityAnchor,
    options?: MessageListRestoreOptions,
  ): void
  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic>
  subscribeSnapshot(listener: MessageListSnapshotListener): () => void
  subscribeRuntimeEvent(listener: MessageListRuntimeEventListener): () => void
  subscribeViewportObservation(
    listener: MessageListRuntimeEventListener,
  ): () => void
  getViewportAnchor(): MessageIdentityAnchor | null
  getDiagnostics(): import('./events').ViewportDiagnosticRecord[]
  getEvidence(): ViewportEvidence
}

export function createMessageListRuntime<
  TMessage = unknown,
  TOptimistic = unknown,
>(
  options: MessageListRuntimeOptions = {},
): MessageListRuntime<TMessage, TOptimistic> {
  return new ContractOnlyMessageListRuntime<TMessage, TOptimistic>(options)
}

class ContractOnlyMessageListRuntime<TMessage, TOptimistic>
  implements MessageListRuntime<TMessage, TOptimistic> {
  private snapshot: MessageListSnapshot<TMessage, TOptimistic>

  private readonly snapshotListeners = new Set<MessageListSnapshotListener>()

  private readonly eventListeners = new Set<MessageListRuntimeEventListener>()

  private scrollContainer: HTMLElement | null = null

  constructor(private readonly options: MessageListRuntimeOptions) {
    this.snapshot = createInitialSnapshot<TMessage, TOptimistic>(
      this.options.feedId ?? 'default',
    )
  }

  attachScrollContainer(container: HTMLElement): void {
    this.scrollContainer = container
  }

  detachScrollContainer(): void {
    this.scrollContainer = null
  }

  destroy(): void {
    this.snapshotListeners.clear()
    this.eventListeners.clear()
    this.scrollContainer = null
  }

  applyLoadedSegment(segment: LoadedSegment<TMessage, TOptimistic>): void {
    const projectionRevision = this.snapshot.projectionRevision + 1
    this.snapshot = {
      ...this.snapshot,
      feedId: segment.feedId,
      generation: segment.generation,
      segmentRevision: segment.segmentRevision,
      projectionRevision,
      commitToken: {
        feedId: segment.feedId,
        generation: segment.generation,
        segmentRevision: segment.segmentRevision,
        projectionRevision,
      },
      items: segment.items,
      segmentMeta: {
        hasMoreBefore: segment.hasMoreBefore,
        hasMoreAfter: segment.hasMoreAfter,
        modifier: segment.modifier,
        anchor: segment.anchor,
        anchorStatus: segment.anchorStatus,
        shortSegmentAlignment: 'start',
        underflow: 'unknown',
      },
    }
    this.emitSnapshot()
  }

  scrollToLatest(): void {
    this.emitNeed('needLatestMessages', 'scrollToLatest')
  }

  scrollToMessage(target: MessageIdentityAnchor): void {
    this.emitNeed('needMessagesAround', 'scrollToMessage', target)
  }

  restoreToMessage(target: MessageIdentityAnchor): void {
    this.emitNeed('needMessagesAround', 'restoreToMessage', target)
  }

  getSnapshot(): MessageListSnapshot<TMessage, TOptimistic> {
    return this.snapshot
  }

  subscribeSnapshot(listener: MessageListSnapshotListener): () => void {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  subscribeRuntimeEvent(listener: MessageListRuntimeEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeViewportObservation(
    listener: MessageListRuntimeEventListener,
  ): () => void {
    return this.subscribeRuntimeEvent(listener)
  }

  getViewportAnchor(): MessageIdentityAnchor | null {
    return this.snapshot.segmentMeta.anchor ?? null
  }

  getDiagnostics(): import('./events').ViewportDiagnosticRecord[] {
    return []
  }

  getEvidence(): ViewportEvidence {
    const rect = createEmptyRect()
    const container = this.scrollContainer
    return {
      feedId: this.snapshot.feedId,
      generation: this.snapshot.generation,
      segmentRevision: this.snapshot.segmentRevision,
      projectionRevision: this.snapshot.projectionRevision,
      commitToken: this.snapshot.commitToken,
      modifier: this.snapshot.segmentMeta.modifier.type,
      hasMoreBefore: this.snapshot.segmentMeta.hasMoreBefore,
      hasMoreAfter: this.snapshot.segmentMeta.hasMoreAfter,
      bottomLockState: this.snapshot.bottomLockState,
      pendingIntent: this.snapshot.pendingIntent,
      shortSegmentAlignment: this.snapshot.segmentMeta.shortSegmentAlignment,
      scrollTop: container?.scrollTop ?? 0,
      clientHeight: container?.clientHeight ?? 0,
      scrollHeight: container?.scrollHeight ?? 0,
      visibleRows: [],
      beforeTrigger: rect,
      afterTrigger: rect,
      bottomMarker: null,
      phase: this.snapshot.viewportPhase,
      edgeState: this.snapshot.edgeState,
    }
  }

  private emitSnapshot(): void {
    for (const listener of this.snapshotListeners) {
      listener()
    }
  }

  private emitNeed(
    type: 'needLatestMessages' | 'needMessagesAround',
    reason: string,
    target?: MessageIdentityAnchor,
  ): void {
    const base = {
      feedId: this.snapshot.feedId,
      generation: this.snapshot.generation,
      segmentRevision: this.snapshot.segmentRevision,
      requestToken: `request:${this.snapshot.projectionRevision + 1}`,
      reason,
    }
    const event = type === 'needMessagesAround'
      ? { ...base, type, target: target as MessageIdentityAnchor }
      : { ...base, type }
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }
}

function createInitialSnapshot<TMessage, TOptimistic>(
  feedId: string,
): MessageListSnapshot<TMessage, TOptimistic> {
  const commitToken = {
    feedId,
    generation: 0,
    segmentRevision: 0,
    projectionRevision: 0,
  }
  return {
    ...commitToken,
    commitToken,
    items: [],
    segmentMeta: {
      hasMoreBefore: false,
      hasMoreAfter: false,
      modifier: { type: 'bootstrap' },
      shortSegmentAlignment: 'start',
      underflow: 'unknown',
    },
    edgeState: {
      before: { status: 'idle' },
      after: { status: 'idle' },
    },
    bottomLockState: 'UNLOCKED',
    pendingIntent: null,
    viewportPhase: 'IDLE',
  }
}

function createEmptyRect(): import('./snapshot').DOMRectLike {
  return {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
  }
}
