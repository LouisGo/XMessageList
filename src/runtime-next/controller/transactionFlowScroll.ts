import { computeRealRowCoverage } from '../geometry/measurement/coverage'
import { stringifyMessageRuntimeItemKey } from '../identity/itemKey'
import type { MessageRuntimeItemKey } from '../identity/types'
import type { ScrollWriterKind } from '../scroll/writerArbitration'
import type {
  PendingPublication,
  RuntimeTransactionFlowContext,
} from './transactionFlow.types'
import { anchorFromTarget } from './controllerHelpers'

export type TransactionScrollTopResult =
  | {
      readonly ok: true
      readonly scrollTop: number
    }
  | {
      readonly ok: false
      readonly scrollTop: number
    }

export function writeTransactionScrollTop<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
): TransactionScrollTopResult {
  const kind = pending.transaction.kind
  const desired = resolveTransactionScrollTop(ctx, pending)
  if (desired === ctx.getCurrentScrollTop()) {
    return {
      ok: true,
      scrollTop: desired,
    }
  }

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
    return {
      ok: false,
      scrollTop: ctx.getCurrentScrollTop(),
    }
  }
  const wrote = ctx.writer.writeScrollTop(ctx.dom.getContainer(), desired, token)
  if (wrote) {
    ctx.setCurrentScrollTop(desired)
  } else {
    ctx.diagnostics.record({
      kind: 'writer-arbitration',
      severity: 'warn',
      owner: 'scroll',
      message: 'transaction writer failed to write scrollTop',
    })
  }
  ctx.writer.release(token)

  return {
    ok: wrote,
    scrollTop: ctx.getCurrentScrollTop(),
  }
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
  if (kind === 'jump' || kind === 'restore' || kind === 'bootstrap') {
    const anchorScrollTop = resolveTargetAnchorScrollTop(pending, maxTop)
    if (anchorScrollTop !== null) return anchorScrollTop
  }

  return Math.min(maxTop, Math.max(0, ctx.getCurrentScrollTop()))
}

function resolveTargetAnchorScrollTop<TMessage, TOptimistic>(
  pending: PendingPublication<TMessage, TOptimistic>,
  maxTop: number,
): number | null {
  const intent = pending.transaction.intent
  const target = 'target' in intent ? intent.target : undefined
  const anchor = anchorFromTarget(target)
  if (anchor === null) return null

  const itemKeys = pending.publication.renderWindow.itemKeys
  const anchorIndex = itemKeys.findIndex(
    (key) =>
      stringifyMessageRuntimeItemKey(key) ===
        stringifyMessageRuntimeItemKey(anchor.key),
  )
  if (anchorIndex < 0) return null

  const rowTop = itemKeys
    .slice(0, anchorIndex)
    .reduce(
      (offset, key, index) =>
        offset + resolveRowHeightPx(pending, key, index),
      pending.publication.topSpacer,
    )
  const anchorOffset = Math.max(0, anchor.offsetWithinMessage)

  return Math.min(maxTop, Math.max(0, rowTop + anchorOffset))
}

function resolveRowHeightPx<TMessage, TOptimistic>(
  pending: PendingPublication<TMessage, TOptimistic>,
  key: MessageRuntimeItemKey,
  index: number,
): number {
  const measured = pending.measuredRowHeights?.get(
    stringifyMessageRuntimeItemKey(key),
  )
  if (measured !== undefined && Number.isFinite(measured) && measured > 0) {
    return measured
  }

  const estimated = pending.publication.items[index]?.estimatedHeight
  if (estimated !== undefined && Number.isFinite(estimated) && estimated > 0) {
    return estimated
  }

  const mountedCount = Math.max(
    1,
    pending.publication.renderWindow.itemKeys.length,
  )
  return pending.publication.mountedRowsHeightEstimate / mountedCount
}
