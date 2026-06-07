import type { MessageDataItem } from '../../runtime/index'
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

export function hasDuplicateItemKeys<Row>(
  left: MessageDataItem<Row>[],
  right: MessageDataItem<Row>[],
): boolean {
  const keys = new Set(left.map((item) => item.key))
  return right.some((item) => keys.has(item.key))
}
