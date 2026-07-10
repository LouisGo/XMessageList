import type {
  LoadedSegment,
  MessageIdentityAnchor,
} from '../../runtime/index'
import type {
  LoadedSegmentStore,
  ResetSegmentInput,
} from '../loaded-segment-store/index'
import type {
  MessageListAdapter,
  MessageListLoadedContext,
  MessageListPage,
} from '../contracts'
import {
  assertLatestPageContract,
  assertReachedLatestContract,
  assertReloadAroundPageContract,
  MessageListContractViolation,
} from './contractDiagnostics'
import { toSessionResetInput } from './helpers'
import type { ReloadContentJournal } from './reloadJournal'

export function prepareReloadProjection<Row, Source>(input: {
  requestKind: 'latest' | 'around'
  target?: MessageIdentityAnchor
  originContext: MessageListLoadedContext
  offsetWithinMessage?: number
  page: MessageListPage<Row>
  journal: ReloadContentJournal<Row>
  sessionId: string
  adapter: MessageListAdapter<Row, Source>
  loadedSegmentStore: LoadedSegmentStore<Row>
  reportDiagnostic: (
    name: string,
    severity: 'debug' | 'info' | 'warn' | 'error',
    details?: Record<string, unknown>,
  ) => void
}): {
  page: MessageListPage<Row>
  segment: LoadedSegment<Row>
  resolution?: 'exact' | 'fallback'
  resolvedAnchor?: MessageIdentityAnchor
} {
  const resetInput = toSessionResetInput(
    input.sessionId,
    input.page,
    input.adapter,
  )
  if (input.requestKind === 'latest') {
    assertLatestPageContract(input.page, input.reportDiagnostic, {
      source: 'commands.reloadCurrent',
    })
    const rebased = rebaseResetInput(input.page, resetInput, input.journal)
    const segment = input.loadedSegmentStore.resetLatest(rebased.resetInput)
    return {
      page: rebased.page,
      segment: {
        ...segment,
        modifier: { type: 'reset-latest', reason: 'structural' },
      },
    }
  }

  const target = input.target
  if (!target) {
    throw new MessageListContractViolation('reloadCurrent.anchorUnavailable')
  }
  assertReachedLatestContract(input.page, input.reportDiagnostic, {
    source: 'commands.reloadCurrent',
  })
  assertReloadAroundPageContract({
    page: input.page,
    target,
    items: resetInput.items,
    report: input.reportDiagnostic,
  })
  const abnormal = Boolean(
    input.page.anchorStatus && input.page.anchorStatus !== 'normal',
  )
  const originalResolvedItem = abnormal
    ? resetInput.items.find((item) =>
        item.identity?.stableId === input.page.anchor?.fallbackStableId
      )
    : resetInput.items.find((item) =>
        item.identity && anchorsMatch(item.identity, target)
      )
  if (!originalResolvedItem?.identity) {
    throw new MessageListContractViolation(
      abnormal ? 'page.reloadFallbackRowMissing' : 'page.reloadTargetRowMissing',
    )
  }

  const rebased = rebaseResetInput(input.page, resetInput, input.journal)
  const resolved = input.journal.resolveRebasedItem(
    originalResolvedItem,
    rebased.resetInput.items,
  )
  if (!resolved?.item.identity) {
    input.reportDiagnostic('page.reloadRebasedTargetMissing', 'error')
    throw new MessageListContractViolation('page.reloadRebasedTargetMissing')
  }
  const resolution = abnormal || resolved.fellBack ? 'fallback' : 'exact'
  const resolvedAnchor = resolved.item.identity
  return {
    page: { ...rebased.page, anchor: resolvedAnchor },
    segment: input.loadedSegmentStore.resetAround({
      ...rebased.resetInput,
      anchor: resolvedAnchor,
      target: resolvedAnchor,
      context: resolveReloadAroundContext(input.originContext, input.page),
      align: 'start',
      offsetWithinMessage: input.offsetWithinMessage,
    }),
    resolution,
    resolvedAnchor,
  }
}

function rebaseResetInput<Row>(
  page: MessageListPage<Row>,
  resetInput: ResetSegmentInput<Row, unknown>,
  journal: ReloadContentJournal<Row>,
): {
  page: MessageListPage<Row>
  resetInput: ResetSegmentInput<Row, unknown>
} {
  const items = journal.rebaseItems(resetInput.items)
  const anchor = resetInput.anchor
    ? journal.rebaseAnchor(resetInput.anchor)
    : undefined
  return {
    page: {
      ...page,
      rows: items.flatMap((item) =>
        item.message === undefined ? [] : [item.message]
      ),
      anchor,
    },
    resetInput: { ...resetInput, items, anchor },
  }
}

function resolveReloadAroundContext<Row>(
  origin: MessageListLoadedContext,
  page: MessageListPage<Row>,
): MessageListLoadedContext {
  if (origin !== 'latest') return origin
  return page.hasMoreAfter ? 'history' : 'latest'
}

function anchorsMatch(
  left: MessageIdentityAnchor,
  right: MessageIdentityAnchor,
): boolean {
  return left.sessionId === right.sessionId && (
    left.stableId === right.stableId ||
    Boolean(left.serverId && left.serverId === right.serverId) ||
    Boolean(left.localId && left.localId === right.localId)
  )
}
