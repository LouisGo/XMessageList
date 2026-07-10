import type {
  MessageDataItem,
  MessageIdentityAnchor,
} from '../../runtime/index'
import type {
  MessageListPage,
  MessageListRuntimeLogDiagnosticRecord,
} from '../contracts'

type ReportDiagnostic = (
  name: string,
  severity: MessageListRuntimeLogDiagnosticRecord['severity'],
  details?: Record<string, unknown>,
) => void

export class MessageListContractViolation extends Error {
  constructor(readonly diagnosticName: string) {
    super(diagnosticName)
    this.name = 'MessageListContractViolation'
  }
}

export function reportContractDiagnostic(
  report: ReportDiagnostic,
  name: string,
  severity: MessageListRuntimeLogDiagnosticRecord['severity'],
  details: Record<string, unknown> = {},
): void {
  report(name, severity, details)
}

export function assertLatestPageContract<Row>(
  page: MessageListPage<Row>,
  report: ReportDiagnostic,
  details: Record<string, unknown> = {},
): void {
  if (page.hasMoreAfter) {
    reportContractDiagnostic(report, 'page.latestHasMoreAfter', 'error', details)
    if (page.reachedLatest) {
      reportContractDiagnostic(report, 'page.reachedLatestHasMoreAfter', 'error', details)
    }
    throw new MessageListContractViolation(
      page.reachedLatest
        ? 'page.reachedLatestHasMoreAfter'
        : 'page.latestHasMoreAfter',
    )
  }

  assertReachedLatestContract(page, report, details)
}

export function assertReachedLatestContract<Row>(
  page: MessageListPage<Row>,
  report: ReportDiagnostic,
  details: Record<string, unknown> = {},
): void {
  if (page.reachedLatest && page.hasMoreAfter) {
    reportContractDiagnostic(report, 'page.reachedLatestHasMoreAfter', 'error', details)
    throw new MessageListContractViolation('page.reachedLatestHasMoreAfter')
  }
}

export function assertInitialHistoryPageContract<Row>(input: {
  items: MessageDataItem<Row>[]
  report: ReportDiagnostic
  target: MessageIdentityAnchor
}): void {
  const targetExists = input.items.some(
    (item) => item.identity && anchorsMatch(item.identity, input.target),
  )
  if (targetExists) return

  input.report('page.initialRestoreTargetMissing', 'error')
  throw new MessageListContractViolation('page.initialRestoreTargetMissing')
}

export function hasDuplicateItemKeys<Row>(
  left: MessageDataItem<Row>[],
  right: MessageDataItem<Row>[],
): boolean {
  const keys = new Set(left.map((item) => item.key))
  return right.some((item) => keys.has(item.key))
}

export function assertReloadAroundPageContract<Row>(input: {
  page: MessageListPage<Row>
  target: MessageIdentityAnchor
  items: MessageDataItem<Row>[]
  report: ReportDiagnostic
}): void {
  const abnormal = input.page.anchorStatus && input.page.anchorStatus !== 'normal'
  const fallbackStableId = input.page.anchor?.fallbackStableId
  const expected = abnormal
    ? input.items.find((item) =>
        item.identity?.sessionId === input.target.sessionId &&
        Boolean(fallbackStableId) &&
        item.identity?.stableId === fallbackStableId
      )
    : input.items.find((item) => item.identity && anchorsMatch(
        item.identity,
        input.target,
      ))

  if (abnormal && !fallbackStableId) {
    input.report('page.reloadFallbackAnchorMissing', 'error')
    throw new MessageListContractViolation('page.reloadFallbackAnchorMissing')
  }

  if (!expected) {
    const name = abnormal
      ? 'page.reloadFallbackRowMissing'
      : 'page.reloadTargetRowMissing'
    input.report(name, 'error')
    throw new MessageListContractViolation(name)
  }
}

function anchorsMatch(
  identity: NonNullable<MessageDataItem['identity']>,
  anchor: MessageIdentityAnchor,
): boolean {
  return identity.sessionId === anchor.sessionId && (
    identity.stableId === anchor.stableId ||
    Boolean(identity.serverId && identity.serverId === anchor.serverId) ||
    Boolean(identity.localId && identity.localId === anchor.localId)
  )
}
