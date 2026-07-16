import type { LoadedSegment } from '../../runtime/index'
import type {
  MessageListPage,
  MessageListRequestResult,
  MessageListRequestTrigger,
  MessageListSessionContext,
  MessageListSessionId,
} from '../contracts'
import type { RuntimeNeedEvent } from './helpers'

type RequestResultInput<Row, Source> = Omit<
  MessageListRequestResult<Row, Source>,
  'sessionId' | 'source'
>

export class MessageListSessionRequestRunner<Row, Source> {
  constructor(private readonly input: {
    sessionId: MessageListSessionId
    context: MessageListSessionContext<Source>
    publishSegment: (segment: LoadedSegment<Row>) => void
    reportEdgeStale: (edge: 'before' | 'after', requestToken: string) => void
    reportEdgeFailure: (edge: 'before' | 'after', requestToken: string) => void
    recordResult: (result: MessageListRequestResult<Row, Source>) => void
    onRequestResult?: (result: MessageListRequestResult<Row, Source>) => void
  }) {}

  async run(
    kind: 'initial' | 'latest' | 'before' | 'after' | 'around',
    event: RuntimeNeedEvent | undefined,
    trigger: MessageListRequestTrigger,
    request: () => Promise<{
      page: MessageListPage<Row>
      segment: LoadedSegment<Row>
      applied: boolean
    }>,
  ): Promise<MessageListRequestResult<Row, Source>> {
    try {
      const result = await request()
      if (!result.applied) {
        if (kind === 'before' || kind === 'after') {
          this.input.reportEdgeStale(kind, event?.requestToken ?? '')
        }
        return this.emit({ kind, status: 'stale', trigger })
      }
      this.input.publishSegment(result.segment)
      return this.emit({ kind, status: 'applied', trigger, page: result.page })
    } catch (error) {
      if (kind === 'before' || kind === 'after') {
        this.input.reportEdgeFailure(kind, event?.requestToken ?? '')
      }
      return this.emit({ kind, status: 'failed', trigger, error })
    }
  }

  emit(
    result: RequestResultInput<Row, Source>,
  ): MessageListRequestResult<Row, Source> {
    const next = {
      sessionId: this.input.sessionId,
      source: this.input.context.source,
      ...result,
    }
    this.input.recordResult(next)
    this.input.onRequestResult?.(next)
    return next
  }
}
