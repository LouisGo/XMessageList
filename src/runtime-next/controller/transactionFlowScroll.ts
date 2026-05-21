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

export type PreparedTransactionScrollTop =
  | {
      readonly ok: true
      readonly scrollTop: number
      readonly commit: () => TransactionScrollTopResult
      readonly cancel: () => void
    }
  | {
      readonly ok: false
      readonly scrollTop: number
    }

export function prepareTransactionScrollTop<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
): PreparedTransactionScrollTop {
  const kind = pending.transaction.kind
  const desired = resolveTransactionScrollTop(ctx, pending)
  if (desired === ctx.getCurrentScrollTop()) {
    return {
      ok: true,
      scrollTop: desired,
      commit: () => ({
        ok: true,
        scrollTop: desired,
      }),
      cancel: noop,
    }
  }

  if (kind === 'followBottom' || kind === 'jump' || kind === 'restore') {
    return prepareMotionScrollTop(ctx, pending, desired, kind)
  }

  const writerKind: ScrollWriterKind = kind === 'segmentShift'
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

  return {
    ok: true,
    scrollTop: desired,
    commit: () => {
      const wrote = ctx.writer.writeScrollTop(
        ctx.dom.getContainer(),
        desired,
        token,
      )
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
    },
    cancel: () => {
      ctx.writer.release(token)
    },
  }
}

function prepareMotionScrollTop<TMessage, TOptimistic>(
  ctx: RuntimeTransactionFlowContext<TMessage, TOptimistic>,
  pending: PendingPublication<TMessage, TOptimistic>,
  desired: number,
  kind: 'followBottom' | 'jump' | 'restore',
): PreparedTransactionScrollTop {
  const currentMetrics = ctx.metrics.getMetrics()
  if (currentMetrics.isDragLocked || currentMetrics.isThumbFrozen) {
    ctx.diagnostics.record({
      kind: 'writer-arbitration',
      severity: 'warn',
      owner: 'scroll',
      message: 'transaction writer denied',
      details: {
        reason: 'active-drag',
        isDragLocked: currentMetrics.isDragLocked,
        isThumbFrozen: currentMetrics.isThumbFrozen,
      },
    })
    return {
      ok: false,
      scrollTop: ctx.getCurrentScrollTop(),
    }
  }

  const viewportSize = ctx.dom.getViewportSize()
  const mountedRowsHeight =
    pending.measuredRowsHeight ?? pending.publication.mountedRowsHeightEstimate
  const coverage = computeRealRowCoverage({
    topSpacer: pending.publication.topSpacer,
    mountedRowsHeight,
    clientHeight: viewportSize.clientHeight,
    scrollTop: desired,
  })
  const prepared = ctx.motion.prepare({
    transactionId: pending.transaction.id,
    targetScrollTop: desired,
    source: kind,
    bounds: {
      safeScrollRangeStart: coverage.safeScrollRangeStart,
      safeScrollRangeEnd: coverage.safeScrollRangeEnd,
      maxScrollPosition: Math.max(
        0,
        pending.publication.physicalWindowHeight - viewportSize.clientHeight,
      ),
    },
  }, {
    dom: ctx.dom,
    writer: ctx.writer,
    diagnostics: ctx.diagnostics,
    setCurrentScrollTop: ctx.setCurrentScrollTop,
  })
  if (!prepared.ok) {
    return {
      ok: false,
      scrollTop: prepared.scrollTop,
    }
  }

  return {
    ok: true,
    scrollTop: prepared.scrollTop,
    commit: () => {
      const wrote = prepared.commit()

      return {
        ok: wrote,
        scrollTop: ctx.getCurrentScrollTop(),
      }
    },
    cancel: prepared.cancel,
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

    if (
      pending.transaction.intent.kind === 'segmentShift' &&
      pending.transaction.intent.source === 'drag-handoff'
    ) {
      const desired = maxTop * 0.5
      return Math.min(
        coverage.safeScrollRangeEnd,
        Math.max(coverage.safeScrollRangeStart, desired),
      )
    }

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

function noop(): void {}
