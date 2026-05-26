import type { MessageIdentityAnchor } from './identity'
import type {
  MessageListRuntimeEventListener,
  ViewportObservationListener,
} from './events'
import { MessageListRuntimeController } from './controller'
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
  reportEdgeRequestFailure(
    edge: 'before' | 'after',
    requestToken: string,
  ): void
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
    listener: ViewportObservationListener,
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
  return new MessageListRuntimeController<TMessage, TOptimistic>(options)
}
