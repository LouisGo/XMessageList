import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { PhysicalMetricsStore } from '../geometry/metrics/metricsStore'
import type { ScrollWriterArbitration } from '../scroll/writerArbitration'
import { directScrollInputToWriterKind } from '../scroll/writerArbitration'
import type { DirectScrollInput } from '../scroll/types'
import { recordWriterIssue } from './runtimeControllerSupport'

const DIRECT_SCROLL_TRANSACTION_ID = 'direct-scroll'

type DirectScrollContext = {
  readonly writer: ScrollWriterArbitration
  readonly metrics: PhysicalMetricsStore
  readonly dom: RuntimeDomRegistry
  readonly diagnostics: DiagnosticRecorder
  readonly setCurrentScrollTop: (scrollTop: number) => void
}

export function beginDirectScrollTransaction(
  input: DirectScrollInput,
  ctx: DirectScrollContext,
): void {
  const token = {
    transactionId: DIRECT_SCROLL_TRANSACTION_ID,
    kind: directScrollInputToWriterKind(input),
  }
  if (!ctx.writer.acquire(token).acquired) {
    recordWriterIssue(
      ctx.diagnostics,
      'drag-lock-stolen',
      'direct scroll writer denied',
    )
    return
  }
  ctx.metrics.promote({ ...ctx.metrics.getMetrics(), isDragLocked: true })
}

export function writeDirectScrollTopWithWriter(
  scrollTop: number,
  input: DirectScrollInput,
  ctx: DirectScrollContext,
): boolean {
  const token = {
    transactionId: DIRECT_SCROLL_TRANSACTION_ID,
    kind: directScrollInputToWriterKind(input),
  }
  const wrote = ctx.writer.writeScrollTop(ctx.dom.getContainer(), scrollTop, token)
  if (wrote) {
    ctx.setCurrentScrollTop(Math.max(0, scrollTop))
  } else {
    recordWriterIssue(
      ctx.diagnostics,
      'writer-arbitration',
      'direct scroll write denied',
    )
  }
  return wrote
}

export function endDirectScrollTransaction(
  input: DirectScrollInput,
  ctx: DirectScrollContext,
): void {
  const token = {
    transactionId: DIRECT_SCROLL_TRANSACTION_ID,
    kind: directScrollInputToWriterKind(input),
  }
  ctx.writer.release(token)
  ctx.metrics.promote({ ...ctx.metrics.getMetrics(), isDragLocked: false })
}
