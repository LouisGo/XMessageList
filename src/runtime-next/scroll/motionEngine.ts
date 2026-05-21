import type { DiagnosticRecorder } from '../diagnostics/recorder'
import type { RuntimeDomRegistry } from '../dom/domRegistry'
import type { RuntimeNextTransactionId } from '../identity/types'
import type { ScrollWriterArbitration, ScrollWriterToken } from './writerArbitration'

export type ScrollMotionStartInput = {
  readonly transactionId: RuntimeNextTransactionId
  readonly targetScrollTop: number
  readonly source: 'followBottom' | 'jump' | 'restore'
  readonly bounds: {
    readonly safeScrollRangeStart: number
    readonly safeScrollRangeEnd: number
    readonly maxScrollPosition: number
  }
}

export type ScrollMotionContext = {
  readonly dom: RuntimeDomRegistry
  readonly writer: ScrollWriterArbitration
  readonly diagnostics: DiagnosticRecorder
  readonly setCurrentScrollTop: (scrollTop: number) => void
}

export type PreparedScrollMotion =
  | {
      readonly ok: true
      readonly scrollTop: number
      readonly commit: () => boolean
      readonly cancel: () => void
    }
  | {
      readonly ok: false
      readonly scrollTop: number
    }

export class ScrollMotionEngine {
  #active: ScrollWriterToken | null = null

  start(input: ScrollMotionStartInput, ctx: ScrollMotionContext): boolean {
    const prepared = this.prepare(input, ctx)
    return prepared.ok && prepared.commit()
  }

  prepare(
    input: ScrollMotionStartInput,
    ctx: ScrollMotionContext,
  ): PreparedScrollMotion {
    this.cancel('replaced', ctx)

    const targetScrollTop = clampScrollTop(
      input.targetScrollTop,
      input.bounds,
    )
    const token: ScrollWriterToken = {
      transactionId: input.transactionId,
      kind: 'motion',
    }
    if (!ctx.writer.acquire(token).acquired) {
      ctx.diagnostics.record({
        kind: 'writer-arbitration',
        severity: 'warn',
        owner: 'scroll',
        message: 'transaction writer denied',
      })
      return {
        ok: false,
        scrollTop: targetScrollTop,
      }
    }

    this.#active = token

    return {
      ok: true,
      scrollTop: targetScrollTop,
      commit: () => {
        ctx.diagnostics.record({
          kind: 'transaction-lifecycle',
          severity: 'info',
          owner: 'scroll',
          message: 'motion.start',
          details: {
            source: input.source,
            scrollTop: targetScrollTop,
          },
        })

        const wrote = ctx.writer.writeScrollTop(
          ctx.dom.getContainer(),
          targetScrollTop,
          token,
        )
        if (wrote) {
          ctx.setCurrentScrollTop(targetScrollTop)
          ctx.diagnostics.record({
            kind: 'transaction-lifecycle',
            severity: 'info',
            owner: 'scroll',
            message: 'motion.settle',
            details: {
              source: input.source,
              scrollTop: targetScrollTop,
            },
          })
        }

        this.cancel('settled', ctx)

        return wrote
      },
      cancel: () => this.cancel('cancelled-before-commit', ctx),
    }
  }

  cancel(reason: string, ctx: ScrollMotionContext): void {
    if (this.#active === null) return
    ctx.writer.release(this.#active)
    if (reason !== 'settled') {
      ctx.diagnostics.record({
        kind: 'transaction-lifecycle',
        severity: 'info',
        owner: 'scroll',
        message: 'motion.cancel',
        details: { reason },
      })
    }
    this.#active = null
  }

  isActive(): boolean {
    return this.#active !== null
  }
}

function clampScrollTop(
  scrollTop: number,
  metrics: {
    readonly safeScrollRangeStart: number
    readonly safeScrollRangeEnd: number
    readonly maxScrollPosition: number
  },
): number {
  const maxScrollPosition = Math.max(0, metrics.maxScrollPosition)
  const safeStart = Math.min(maxScrollPosition, metrics.safeScrollRangeStart)
  const safeEnd = Math.min(
    maxScrollPosition,
    Math.max(safeStart, metrics.safeScrollRangeEnd),
  )

  return Math.min(
    safeEnd,
    Math.max(safeStart, Number.isFinite(scrollTop) ? scrollTop : safeStart),
  )
}
