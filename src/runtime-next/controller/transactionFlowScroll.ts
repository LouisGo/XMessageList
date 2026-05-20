import { computeRealRowCoverage } from '../geometry/measurement/coverage'
import type { ScrollWriterKind } from '../scroll/writerArbitration'
import type {
  PendingPublication,
  RuntimeTransactionFlowContext,
} from './transactionFlow.types'

export function writeTransactionScrollTop<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
): number {
  const kind = pending.transaction.kind
  const desired = resolveTransactionScrollTop(ctx, pending)
  if (desired === ctx.getCurrentScrollTop()) return desired

  const writerKind: ScrollWriterKind = kind === 'followBottom'
    ? 'follow-bottom'
    : kind === 'segmentShift'
      ? 'segment-shift-rebase'
      : 'anchor-correction'
  const token = { transactionId: pending.transaction.id, kind: writerKind }
  if (!ctx.writer.acquire(token).acquired) {
    ctx.diagnostics.record({
      kind: 'writer-arbitration',
      severity: 'warn',
      owner: 'scroll',
      message: 'transaction writer denied',
    })
    return ctx.getCurrentScrollTop()
  }
  if (ctx.writer.writeScrollTop(ctx.dom.getContainer(), desired, token)) {
    ctx.setCurrentScrollTop(desired)
  }
  ctx.writer.release(token)

  return ctx.getCurrentScrollTop()
}

export function resolveTransactionScrollTop<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
  measuredRowsHeight = pending.measuredRowsHeight ??
    pending.publication.mountedRowsHeightEstimate,
): number {
  const kind = pending.transaction.kind
  const viewportSize = ctx.dom.getViewportSize()
  const maxTop = Math.max(
    0,
    pending.publication.physicalWindowHeight - viewportSize.clientHeight,
  )
  if (kind === 'followBottom') {
    return maxTop
  }
  if (kind === 'segmentShift') {
    const coverage = computeRealRowCoverage({
      topSpacer: pending.publication.topSpacer,
      mountedRowsHeight: measuredRowsHeight,
      clientHeight: viewportSize.clientHeight,
      scrollTop: 0,
    })
    const direction = pending.transaction.intent.kind === 'segmentShift'
      ? pending.transaction.intent.direction
      : 'after'
    const safeTop = direction === 'before'
      ? coverage.safeScrollRangeEnd
      : coverage.safeScrollRangeStart

    return Math.min(maxTop, Math.max(0, safeTop))
  }

  return Math.min(maxTop, Math.max(0, ctx.getCurrentScrollTop()))
}
