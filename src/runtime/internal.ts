import type { MessageRuntimeItemKey } from './identity'
import type { MessageListRuntime } from './runtime'
import type { ProjectionCommitToken } from './snapshot'

export type DirectScrollInput = {
  source: 'custom-scrollbar-drag' | 'custom-scrollbar-track'
}

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
    beginDirectScroll(input: DirectScrollInput): void
    writeDirectScrollTop(scrollTop: number, input: DirectScrollInput): boolean
    endDirectScroll(input: DirectScrollInput): void
  }

export function getMessageListAdapterRuntime<
  TMessage,
  TOptimistic,
>(
  runtime: MessageListRuntime<TMessage, TOptimistic>,
): MessageListAdapterRuntime<TMessage, TOptimistic> {
  return runtime as MessageListAdapterRuntime<TMessage, TOptimistic>
}
