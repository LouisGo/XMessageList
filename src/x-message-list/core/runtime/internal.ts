import type { MessageIdentityAnchor, MessageRuntimeItemKey } from './contracts/identity'
import type { MessageListRuntime } from './controller/runtime'
import type { ProjectionCommitToken } from './contracts/snapshot'
import type { RuntimeSegmentSizeSnapshot } from './dom/rowMetricCache'

export type { ProjectionCommitToken } from './contracts/snapshot'

// React adapter 持有 DOM ref 和 commit ack，因此比公开 runtime 多出 DOM 注册与 direct-scroll 方法。
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

// session-registry 只需要命令式数据/边缘请求入口，类型层不暴露 adapter 的 DOM 写入能力。
export type MessageListSessionRegistryRuntime<TMessage = unknown, TOptimistic = unknown> =
  MessageListRuntime<TMessage, TOptimistic> & {
    /** Session retain 生命周期决定当前 projection 是否应等待 React commit ack。 */
    setViewRetained(retained: boolean): void
    /** session-only live anchor capture; unlike the public identity getter, this retains row-local offset. */
    getViewportAnchorMemory(): {
      anchor: MessageIdentityAnchor
      offsetWithinMessage?: number
    } | null
    prepareFollowBottomForLocalReset(): void
    reportSessionDiagnostic(
      name: string,
      severity: 'debug' | 'info' | 'warn' | 'error',
      details?: Record<string, unknown>,
    ): void
    startEdgeRequest(edge: 'before' | 'after', reason: string): void
    reportEdgeRequestStale(edge: 'before' | 'after', requestToken: string): void
    getSegmentSizeSnapshot(): RuntimeSegmentSizeSnapshot
    /** invalidateAfter 的同步原子安全探针；不改变 runtime 状态。 */
    probeInvalidateAfterSafety(input: { suffixKeys: MessageRuntimeItemKey[] }):
      | 'safe'
      | 'runtime-busy'
      | 'visible-range-overlap'
    /** Internal-only structural reload stage; draft store is committed by the ack gate. */
    stageLoadedSegment(
      segment: import('./contracts/segment').LoadedSegment<TMessage, TOptimistic>,
      stage: { commit(): boolean },
    ): boolean
    cancelStagedProjection(
      segment: Pick<ProjectionCommitToken, 'sessionId' | 'generation' | 'segmentRevision'>,
    ): boolean
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
