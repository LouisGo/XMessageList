import type { LoadedSegment } from '../../runtime/index'
import type { MessageListSessionRegistryRuntime } from '../../runtime/internal'
import type { LoadedSegmentStore } from '../loaded-segment-store/index'
import type {
  MessageListAdapter,
  MessageListPage,
  MessageListRequestContext,
  MessageListRequestTrigger,
  MessageListRuntimeLogDiagnosticRecord,
  MessageListSessionId,
} from '../contracts'
import { assertReachedLatestContract } from './contractDiagnostics'
import {
  resolveExtendedContext,
  toSessionResetInput,
  type RuntimeNeedEvent,
} from './helpers'

export async function loadMessageListEdgeWindow<Row, Source>(input: {
  adapter: MessageListAdapter<Row, Source>
  boundaryRow: Row
  context: Omit<
    MessageListRequestContext<Row, Source>,
    'boundaryRow' | 'pageSize' | 'reason' | 'requestToken' | 'signal' | 'trigger'
  >
  edge: 'before' | 'after'
  event: RuntimeNeedEvent
  isStale: () => boolean
  loadedSegmentStore: LoadedSegmentStore<Row>
  pageSize: number
  report: (
    name: string,
    severity: MessageListRuntimeLogDiagnosticRecord['severity'],
    details?: Record<string, unknown>,
  ) => void
  runtime: MessageListSessionRegistryRuntime<Row>
  sessionId: MessageListSessionId
  signal: AbortSignal
  trigger: MessageListRequestTrigger
}): Promise<{
  applied: boolean
  page: MessageListPage<Row>
  segment: LoadedSegment<Row>
}> {
  const page = await (
    input.edge === 'before'
      ? input.adapter.request.loadBefore
      : input.adapter.request.loadAfter
  )({
    ...input.context,
    pageSize: input.pageSize,
    requestToken: input.event.requestToken,
    trigger: input.trigger,
    reason: input.event.reason,
    boundaryRow: input.boundaryRow,
    signal: input.signal,
  })
  if (input.isStale()) {
    return {
      page,
      segment: input.loadedSegmentStore.getSegment(),
      applied: false,
    }
  }

  const currentSegment = input.loadedSegmentStore.getSegment()
  assertReachedLatestContract(page, input.report, {
    requestKind: input.edge,
    trigger: input.trigger,
    context: currentSegment.context,
  })
  if (
    input.edge === 'after' &&
    page.reachedLatest &&
    currentSegment.context === 'around'
  ) {
    input.report('aroundReachedLatestIgnored', 'warn', {
      requestKind: input.edge,
      trigger: input.trigger,
    })
  }
  const nextContext = resolveExtendedContext({
    edge: input.edge,
    currentContext: currentSegment.context,
    reachedLatest: page.reachedLatest,
  })
  if (
    input.edge === 'after' &&
    currentSegment.context === 'history' &&
    nextContext === 'latest' &&
    input.trigger === 'viewport'
  ) {
    input.runtime.prepareFollowBottomForLocalReset()
  }
  const resetInput = {
    ...toSessionResetInput(input.sessionId, page, input.adapter),
    hasMoreBefore:
      input.edge === 'before'
        ? page.hasMoreBefore
        : currentSegment.hasMoreBefore,
    hasMoreAfter:
      input.edge === 'after' ? page.hasMoreAfter : currentSegment.hasMoreAfter,
    context: nextContext,
    requestToken: input.event.requestToken,
    anchor: currentSegment.anchor,
    anchorStatus: currentSegment.anchorStatus,
  }
  const applied =
    input.edge === 'before'
      ? input.loadedSegmentStore.extendBefore(resetInput)
      : input.loadedSegmentStore.extendAfter(resetInput)
  return { page, segment: applied.segment, applied: applied.applied }
}
