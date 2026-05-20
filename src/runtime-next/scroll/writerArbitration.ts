import type {
  RuntimeNextTransactionId,
} from '../identity/types'
import type { DirectScrollInput } from './types'

export type ScrollWriterKind =
  | 'direct-drag'
  | 'direct-track'
  | 'anchor-correction'
  | 'segment-shift-rebase'
  | 'follow-bottom'

export type ScrollWriterToken = {
  readonly transactionId: RuntimeNextTransactionId
  readonly kind: ScrollWriterKind
}

export type ScrollWriterArbitrationResult =
  | { readonly acquired: true; readonly token: ScrollWriterToken }
  | { readonly acquired: false; readonly active: ScrollWriterToken }

export class ScrollWriterArbitration {
  #active: ScrollWriterToken | null = null

  acquire(token: ScrollWriterToken): ScrollWriterArbitrationResult {
    if (this.#active === null || isSameWriter(this.#active, token)) {
      this.#active = token

      return {
        acquired: true,
        token,
      }
    }

    return {
      acquired: false,
      active: this.#active,
    }
  }

  writeScrollTop(
    container: HTMLElement | null,
    scrollTop: number,
    token: ScrollWriterToken,
  ): boolean {
    if (
      container === null ||
      this.#active === null ||
      !isSameWriter(this.#active, token)
    ) {
      return false
    }

    container.scrollTop = Math.max(0, scrollTop)

    return true
  }

  release(token: ScrollWriterToken): boolean {
    if (this.#active === null || !isSameWriter(this.#active, token)) {
      return false
    }

    this.#active = null

    return true
  }

  releaseTransaction(transactionId: RuntimeNextTransactionId): void {
    if (this.#active?.transactionId === transactionId) {
      this.#active = null
    }
  }

  forceRelease(): void {
    this.#active = null
  }

  getActiveWriter(): ScrollWriterToken | null {
    return this.#active
  }
}

export function directScrollInputToWriterKind(
  input: DirectScrollInput,
): ScrollWriterKind {
  return input.source === 'custom-scrollbar-track'
    ? 'direct-track'
    : 'direct-drag'
}

function isSameWriter(
  left: ScrollWriterToken,
  right: ScrollWriterToken,
): boolean {
  return left.transactionId === right.transactionId && left.kind === right.kind
}
