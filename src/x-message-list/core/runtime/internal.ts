import type { MessageRuntimeItemKey } from './contracts/identity'
import type { MessageListRuntime } from './controller/runtime'
import type { ProjectionCommitToken } from './contracts/snapshot'
import type { RuntimeSegmentSizeSnapshot } from './dom/rowMetricCache'

export type { ProjectionCommitToken } from './contracts/snapshot'

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
    reportOverlayDiagnostic?(name: string, details: Record<string, unknown>): void
    beginDirectScroll(): void
    writeDirectScrollTop(scrollTop: number): boolean
    endDirectScroll(): void
    notifyDirectScrollRebased(): void
  }

export type MessageListSessionRegistryRuntime<TMessage = unknown, TOptimistic = unknown> =
  MessageListRuntime<TMessage, TOptimistic> & {
    prepareFollowBottomForLocalReset(): void
    startEdgeRequest(edge: 'before' | 'after', reason: string): void
    getSegmentSizeSnapshot(): RuntimeSegmentSizeSnapshot
  }

export function getMessageListAdapterRuntime<
  TMessage,
  TOptimistic,
>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListAdapterRuntime<TMessage, TOptimistic> {
  return runtime as MessageListAdapterRuntime<TMessage, TOptimistic>
}

export function getMessageListSessionRegistryRuntime<
  TMessage,
  TOptimistic,
>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListSessionRegistryRuntime<TMessage, TOptimistic> {
  return runtime as MessageListSessionRegistryRuntime<TMessage, TOptimistic>
}
