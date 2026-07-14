import type {
  MessageIdentityAnchor,
  MessageListRuntimeEvent,
} from '../../runtime/index'
import { normalizeMessageListAnchor } from '../adapters/rowAdapter'
import type {
  MessageListAnchor,
  MessageListDestinationDispatchResult,
  MessageListDestinationState,
  MessageListRequestResult,
  MessageListSessionId,
} from '../contracts'
import { MessageListContractViolation } from './contractDiagnostics'

/** 将 viewport 的细粒度事件收敛为单个 Session 的公开 destination 生命周期。 */
export class MessageListSessionDestinationController {
  private sequence = 0
  private requestToken: string | null = null
  private projection: { generation: number; segmentRevision: number } | null = null
  private state: MessageListDestinationState = { status: 'idle' }

  constructor(
    private readonly sessionId: MessageListSessionId,
    private readonly isDestroyed: () => boolean,
    private readonly notify: () => void,
  ) {}

  getState(): MessageListDestinationState { return this.state }

  dispatch(
    target: MessageListAnchor,
    start: (target: MessageIdentityAnchor) => void,
  ): MessageListDestinationDispatchResult {
    if (this.isDestroyed()) {
      return { status: 'rejected', reason: 'session-destroyed' }
    }

    this.cancel('superseded')
    const normalizedTarget = normalizeMessageListAnchor(this.sessionId, target)
    const destinationId = `${this.sessionId}:destination:${++this.sequence}`
    this.requestToken = null
    this.projection = null
    this.setState({
      status: 'pending',
      destinationId,
      target: normalizedTarget,
    })
    start(normalizedTarget)
    return { status: 'accepted', destinationId }
  }

  handleRuntimeEvent(event: MessageListRuntimeEvent): void {
    const current = this.state
    if (current.status !== 'pending') return

    if (event.type === 'needMessagesAround') {
      if (sameTarget(current.target, event.target)) this.requestToken = event.requestToken
      return
    }
    if (event.type === 'destinationSettled') {
      if (!sameTarget(current.target, event.target)) return
      this.requestToken = null
      this.projection = null
      this.setState({
        status: 'settled',
        destinationId: current.destinationId,
        target: current.target,
        resolution: event.resolution,
        resolvedTarget: event.resolvedTarget,
      })
      return
    }
    if (event.type === 'viewportNavigationIntent') {
      this.cancel('user-interrupt')
      return
    }
    if (event.type === 'destinationCancelled' && this.requestToken === event.requestToken) {
      this.cancel('user-interrupt')
      return
    }
    if (
      event.type === 'projectionSettled' &&
      event.status === 'commit-timeout' &&
      event.generation === this.projection?.generation &&
      event.segmentRevision === this.projection?.segmentRevision
    ) {
      this.fail('commit-timeout')
    }
  }

  expectProjection(
    requestToken: string,
    projection: { generation: number; segmentRevision: number },
  ): void {
    if (this.state.status === 'pending' && this.requestToken === requestToken) {
      this.projection = projection
    }
  }

  finishRequest<Row, Source>(
    requestToken: string,
    result: MessageListRequestResult<Row, Source>,
  ): void {
    if (this.state.status !== 'pending' || this.requestToken !== requestToken) return

    if (result.status === 'failed') {
      this.fail(
        result.error instanceof MessageListContractViolation
          ? 'contract-violation'
          : 'request-failed',
        result.error,
      )
    } else if (result.status === 'stale') {
      this.cancel('superseded')
    }
  }

  destroy(): void { this.cancel('session-destroyed') }

  private cancel(
    reason: Extract<MessageListDestinationState, { status: 'cancelled' }>['reason'],
  ): void {
    const current = this.state
    if (current.status !== 'pending') return
    this.requestToken = null
    this.projection = null
    this.setState({
      status: 'cancelled',
      destinationId: current.destinationId,
      target: current.target,
      reason,
    })
  }

  private fail(
    reason: Extract<MessageListDestinationState, { status: 'failed' }>['reason'],
    error?: unknown,
  ): void {
    const current = this.state
    if (current.status !== 'pending') return
    this.requestToken = null
    this.projection = null
    this.setState({
      status: 'failed',
      destinationId: current.destinationId,
      target: current.target,
      reason,
      ...(error === undefined ? {} : { error }),
    })
  }

  private setState(state: MessageListDestinationState): void {
    this.state = state
    this.notify()
  }
}

function sameTarget(left: MessageListAnchor, right: MessageIdentityAnchor): boolean {
  const stableId = left.stableId ?? left.serverId ?? left.localId ?? left.id
  return left.sessionId === right.sessionId && stableId === right.stableId
}
