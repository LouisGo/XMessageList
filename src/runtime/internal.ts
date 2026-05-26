import type { MessageRuntimeItemKey } from './identity'
import type { MessageListRuntime } from './runtime'
import type { ProjectionCommitToken } from './snapshot'

export type MessageListAdapterRuntime<TMessage = unknown, TOptimistic = unknown> =
  MessageListRuntime<TMessage, TOptimistic> & {
    registerMessageFlowElement(element: HTMLElement | null): void
    registerBeforeTriggerElement(element: HTMLElement | null): void
    registerAfterTriggerElement(element: HTMLElement | null): void
    registerBottomMarkerElement(element: HTMLElement | null): void
    registerRowElement(
      key: MessageRuntimeItemKey,
      element: HTMLElement | null,
    ): void
    ackProjectionCommit(token: ProjectionCommitToken): void
    retryEdgeRequest(edge: 'before' | 'after'): void
    reportOverlayMetricMismatch(details: Record<string, unknown>): void
    beginDirectScroll(): void
    writeDirectScrollTop(scrollTop: number): boolean
    endDirectScroll(): void
  }

export function getMessageListAdapterRuntime<
  TMessage,
  TOptimistic,
>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListAdapterRuntime<TMessage, TOptimistic> {
  return runtime as MessageListAdapterRuntime<TMessage, TOptimistic>
}
