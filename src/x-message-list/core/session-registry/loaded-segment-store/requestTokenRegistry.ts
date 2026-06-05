export type LoadedSegmentRequestKind =
  | 'before'
  | 'after'
  | 'latest'
  | 'around'

export type LoadedSegmentRequestToken = {
  requestToken: string
  generation: number
  segmentRevision: number
  kind: LoadedSegmentRequestKind
}

/**
 * 维护每种请求的 current pointer；旧 token 可以被安全拒绝，但不能误清掉更新的 current token。
 */
export class LoadedSegmentRequestTokenRegistry {
  private requestSequence = 0

  private readonly pendingRequests = new Map<string, LoadedSegmentRequestToken>()

  private readonly currentRequestByKind = new Map<LoadedSegmentRequestKind, string>()

  constructor(private readonly sessionId: string) {}

  create(
    kind: LoadedSegmentRequestKind,
    generation: number,
    segmentRevision: number,
  ): LoadedSegmentRequestToken {
    const request = {
      requestToken: `${this.sessionId}:${kind}:${this.requestSequence + 1}`,
      generation,
      segmentRevision,
      kind,
    }
    this.requestSequence += 1
    this.supersedeConflictingKinds(request.kind)
    this.pendingRequests.set(request.requestToken, request)
    this.currentRequestByKind.set(request.kind, request.requestToken)
    return request
  }

  adopt(
    request: LoadedSegmentRequestToken,
    generation: number,
    segmentRevision: number,
  ): void {
    if (
      request.generation !== generation ||
      (
        !isResetRequestKind(request.kind) &&
        request.segmentRevision !== segmentRevision
      )
    ) {
      return
    }

    this.supersedeConflictingKinds(request.kind)
    this.pendingRequests.set(request.requestToken, request)
    this.currentRequestByKind.set(request.kind, request.requestToken)
  }

  consume(
    requestToken: string,
    expectedKind: LoadedSegmentRequestKind,
    generation: number,
    segmentRevision: number,
  ): LoadedSegmentRequestToken | null {
    const request = this.pendingRequests.get(requestToken)
    // 只删除被消费的 token；如果它已被更新 token 替代，current pointer 必须保留。
    this.pendingRequests.delete(requestToken)

    if (!request) {
      return null
    }

    const currentToken = this.currentRequestByKind.get(request.kind)
    const isCurrent = currentToken === requestToken

    if (
      request.kind !== expectedKind ||
      request.generation !== generation ||
      (
        !isResetRequestKind(request.kind) &&
        request.segmentRevision !== segmentRevision
      ) ||
      !isCurrent
    ) {
      if (isCurrent) {
        this.currentRequestByKind.delete(request.kind)
      }
      return null
    }

    this.currentRequestByKind.delete(request.kind)
    return request
  }

  reset(): void {
    this.pendingRequests.clear()
    this.currentRequestByKind.clear()
  }

  private supersedeConflictingKinds(kind: LoadedSegmentRequestKind): void {
    if (kind !== 'latest' && kind !== 'around') {
      return
    }

    this.currentRequestByKind.delete(kind === 'latest' ? 'around' : 'latest')
    this.currentRequestByKind.delete('before')
    this.currentRequestByKind.delete('after')
  }
}

function isResetRequestKind(kind: LoadedSegmentRequestKind): boolean {
  return kind === 'latest' || kind === 'around'
}
