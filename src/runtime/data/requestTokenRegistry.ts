export type DataRuntimeRequestKind =
  | 'before'
  | 'after'
  | 'latest'
  | 'around'

export type DataRuntimeRequestToken = {
  requestToken: string
  generation: number
  kind: DataRuntimeRequestKind
}

export class DataRuntimeRequestTokenRegistry {
  private requestSequence = 0

  private readonly pendingRequests = new Map<string, DataRuntimeRequestToken>()

  private readonly currentRequestByKind = new Map<DataRuntimeRequestKind, string>()

  constructor(private readonly feedId: string) {}

  create(
    kind: DataRuntimeRequestKind,
    generation: number,
  ): DataRuntimeRequestToken {
    const request = {
      requestToken: `${this.feedId}:${kind}:${this.requestSequence + 1}`,
      generation,
      kind,
    }
    this.requestSequence += 1
    this.pendingRequests.set(request.requestToken, request)
    this.currentRequestByKind.set(request.kind, request.requestToken)
    return request
  }

  adopt(
    request: DataRuntimeRequestToken,
    generation: number,
  ): void {
    if (request.generation !== generation) {
      return
    }

    if (request.kind === 'around') {
      this.currentRequestByKind.delete('latest')
    }
    if (request.kind === 'latest') {
      this.currentRequestByKind.delete('around')
    }
    this.pendingRequests.set(request.requestToken, request)
    this.currentRequestByKind.set(request.kind, request.requestToken)
  }

  consume(
    requestToken: string,
    expectedKind: DataRuntimeRequestKind,
    generation: number,
  ): DataRuntimeRequestToken | null {
    const request = this.pendingRequests.get(requestToken)
    this.pendingRequests.delete(requestToken)

    if (!request) {
      return null
    }

    const currentToken = this.currentRequestByKind.get(request.kind)
    const isCurrent = currentToken === requestToken

    if (
      request.kind !== expectedKind ||
      request.generation !== generation ||
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
}
