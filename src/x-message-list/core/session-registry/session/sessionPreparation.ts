import type {
  LoadedSegment,
  MessageIdentityAnchor,
} from '../../runtime/index'
import { normalizeMessageListAnchor } from '../adapters/rowAdapter'
import type {
  MessageListRequestResult,
  MessageListSessionId,
  MessageListSessionPrepareOptions,
  MessageListSessionPrepareResult,
} from '../contracts'
import { MessageListContractViolation } from './contractDiagnostics'
import type { AroundRequestOptions } from './helpers'

type PreparationRequestResult<Row, Source> = MessageListRequestResult<
  Row,
  Source
>

export class MessageListSessionPreparation<Row, Source> {
  private lastRequestResult: PreparationRequestResult<Row, Source> | null = null

  constructor(private readonly input: {
    sessionId: MessageListSessionId
    isDestroyed: () => boolean
    getSegment: () => LoadedSegment<Row>
    hasOverlayError: () => boolean
    runBootstrap: (restart: boolean) => Promise<void>
    loadAround: (
      target: MessageIdentityAnchor,
      options: AroundRequestOptions,
    ) => Promise<PreparationRequestResult<Row, Source>>
  }) {}

  recordRequestResult(result: PreparationRequestResult<Row, Source>): void {
    if (
      result.status !== 'stale' &&
      (result.kind === 'initial' ||
        result.kind === 'latest' ||
        result.kind === 'around')
    ) {
      this.lastRequestResult = result
    }
  }

  async prepare(
    options: MessageListSessionPrepareOptions = {},
  ): Promise<MessageListSessionPrepareResult> {
    if (this.input.isDestroyed()) {
      return { status: 'stale', reason: 'session-destroyed' }
    }
    if (options.signal?.aborted) {
      return { status: 'stale', reason: 'aborted' }
    }

    const overlayFailed = this.input.hasOverlayError()
    const warm = overlayFailed ? null : this.resolveWarm(options)
    if (warm) return warm

    const restartBootstrap =
      this.lastRequestResult?.status === 'failed' || overlayFailed
    const preparation = options.target
      ? this.prepareAround(options)
      : this.prepareBootstrap(restartBootstrap)
    return awaitAbortablePreparation(preparation, options.signal)
  }

  private async prepareBootstrap(
    restart: boolean,
  ): Promise<MessageListSessionPrepareResult> {
    await this.input.runBootstrap(restart)
    if (this.input.isDestroyed()) {
      return { status: 'stale', reason: 'session-destroyed' }
    }

    const warm = this.resolveWarm({})
    return warm ?? this.mapRequestResult(this.lastRequestResult)
  }

  private async prepareAround(
    options: MessageListSessionPrepareOptions,
  ): Promise<MessageListSessionPrepareResult> {
    const target = normalizeMessageListAnchor(
      this.input.sessionId,
      options.target!,
    )
    const result = await this.input.loadAround(target, {
      context: 'around',
      trigger: 'command',
      align: options.align,
      offsetWithinMessage: options.offsetWithinMessage,
    })
    return this.mapRequestResult(result, true)
  }

  private resolveWarm(
    options: MessageListSessionPrepareOptions,
  ): MessageListSessionPrepareResult | null {
    const segment = this.input.getSegment()
    if (segment.segmentRevision <= 0) return null

    if (options.target) {
      const target = normalizeMessageListAnchor(
        this.input.sessionId,
        options.target,
      )
      const containsTarget = segment.items.some(
        (item) => item.identity?.stableId === target.stableId,
      )
      const preparedTarget = segment.modifier.type === 'reset-around' &&
        segment.modifier.target.stableId === target.stableId
      if (!containsTarget && !preparedTarget) return null
      return {
        status: 'ready',
        requestKind: 'around',
        resolution: segment.anchorStatus && segment.anchorStatus !== 'normal'
          ? 'fallback'
          : 'target',
      }
    }

    return {
      status: 'ready',
      requestKind: resolvePreparationRequestKind(
        this.lastRequestResult,
        segment,
      ),
      resolution: segment.items.length === 0
        ? 'empty'
        : segment.context === 'latest'
          ? 'latest'
          : 'history',
    }
  }

  private mapRequestResult(
    result: PreparationRequestResult<Row, Source> | null,
    targeted = false,
  ): MessageListSessionPrepareResult {
    if (!result || result.status === 'stale') {
      return { status: 'stale', reason: 'superseded' }
    }
    if (result.status === 'failed') {
      return {
        status: 'failed',
        reason: result.error instanceof MessageListContractViolation
          ? 'contract-violation'
          : 'request-failed',
        error: result.error,
      }
    }

    const segment = this.input.getSegment()
    return {
      status: 'ready',
      requestKind: result.kind as 'initial' | 'latest' | 'around',
      resolution: segment.items.length === 0
        ? 'empty'
        : targeted
          ? segment.anchorStatus && segment.anchorStatus !== 'normal'
            ? 'fallback'
            : 'target'
          : segment.context === 'latest'
            ? 'latest'
            : 'history',
    }
  }
}

function resolvePreparationRequestKind<Row, Source>(
  result: PreparationRequestResult<Row, Source> | null,
  segment: LoadedSegment<Row>,
): 'initial' | 'latest' | 'around' {
  if (
    result?.kind === 'initial' ||
    result?.kind === 'latest' ||
    result?.kind === 'around'
  ) {
    return result.kind
  }
  return segment.context === 'latest' ? 'latest' : 'around'
}

async function awaitAbortablePreparation(
  preparation: Promise<MessageListSessionPrepareResult>,
  signal?: AbortSignal,
): Promise<MessageListSessionPrepareResult> {
  if (!signal) return preparation
  if (signal.aborted) return { status: 'stale', reason: 'aborted' }

  return new Promise((resolve) => {
    const handleAbort = () => {
      signal.removeEventListener('abort', handleAbort)
      resolve({ status: 'stale', reason: 'aborted' })
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    void preparation.then(
      (result) => {
        signal.removeEventListener('abort', handleAbort)
        resolve(result)
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort)
        resolve({ status: 'failed', reason: 'request-failed', error })
      },
    )
  })
}
