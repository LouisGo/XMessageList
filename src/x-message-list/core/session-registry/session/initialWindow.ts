import type { LoadedSegment } from '../../runtime/index'
import type { LoadedSegmentStore, ResetSegmentInput } from '../loaded-segment-store/index'
import { normalizeMessageListAnchor } from '../adapters/rowAdapter'
import type {
  MessageListAdapter,
  MessageListInitialWindow,
  MessageListPage,
  MessageListRuntimeLogDiagnosticRecord,
  MessageListSessionId,
} from '../contracts'
import { toSessionResetInput } from './helpers'
import {
  assertInitialHistoryPageContract,
  assertLatestPageContract,
  assertReachedLatestContract,
} from './contractDiagnostics'

type InitialWindowDiagnosticReporter = (
  name: string,
  severity: MessageListRuntimeLogDiagnosticRecord['severity'],
  details?: Record<string, unknown>,
) => void

export function applyMessageListInitialWindow<Row, Source>(input: {
  sessionId: MessageListSessionId
  initial: MessageListInitialWindow<Row>
  adapter: MessageListAdapter<Row, Source>
  loadedSegmentStore: LoadedSegmentStore<Row>
  withPendingLocal: (page: MessageListPage<Row>) => {
    page: MessageListPage<Row>
    resetInput: ResetSegmentInput<Row, unknown>
  }
  report: InitialWindowDiagnosticReporter
  trigger: string
}): { page: MessageListPage<Row>; segment: LoadedSegment<Row> } {
  if (input.initial.context === 'latest') {
    assertLatestPageContract(input.initial.page, input.report, {
      requestKind: 'initial',
      context: 'latest',
      trigger: input.trigger,
    })
    const local = input.withPendingLocal(input.initial.page)
    return {
      page: local.page,
      segment: input.loadedSegmentStore.resetLatest(local.resetInput),
    }
  }

  assertReachedLatestContract(input.initial.page, input.report, {
    requestKind: 'initial',
    context: 'history',
    trigger: input.trigger,
  })
  const target = normalizeMessageListAnchor(
    input.sessionId,
    input.initial.restore.anchor,
  )
  const resetInput = toSessionResetInput(
    input.sessionId,
    input.initial.page,
    input.adapter,
  )
  assertInitialHistoryPageContract({
    items: resetInput.items,
    report: input.report,
    target,
  })
  return {
    page: input.initial.page,
    segment: input.loadedSegmentStore.resetAround({
      ...resetInput,
      target,
      context: 'history',
      align: 'start',
      offsetWithinMessage: input.initial.restore.offsetWithinMessage,
    }),
  }
}
