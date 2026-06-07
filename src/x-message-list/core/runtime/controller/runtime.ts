import type { MessageIdentityAnchor } from '../contracts/identity'
import type {
  MessageListRuntimeEventListener,
  ViewportObservationListener,
} from '../contracts/events'
import { MessageListRuntimeController } from './MessageListRuntimeController'
import type { LoadedSegment } from '../contracts/segment'
import type {
  MessageListRestoreOptions,
  MessageListRuntimeOptions,
  MessageListScrollOptions,
  MessageListScrollToMessageOptions,
} from '../contracts/options'
import type {
  MessageListSnapshot,
  MessageListSnapshotListener,
  ViewportEvidence,
} from '../contracts/snapshot'

// 公开 facade 只暴露宿主可调用的视口能力；React adapter 专用 DOM 注册能力在 internal.ts 扩展。
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
  getDiagnostics(): import('../contracts/events').ViewportDiagnosticRecord[]
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
