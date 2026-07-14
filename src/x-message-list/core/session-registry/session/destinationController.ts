import type {
  MessageIdentityAnchor,
  MessageListRuntimeEvent,
} from '../../runtime/index'
import { normalizeMessageListAnchor } from '../adapters/rowAdapter'
import type {
  MessageListAnchor,
  MessageListDestinationCancelInput,
  MessageListDestinationCancelResult,
  MessageListDestinationDispatchResult,
  MessageListDestinationState,
  MessageListRequestResult,
  MessageListSessionId,
} from '../contracts'
import { MessageListContractViolation } from './contractDiagnostics'
import type { MessageListDestinationPublishOptions } from './state'

/** 将 viewport 的细粒度事件收敛为单个 Session 的公开 destination 生命周期。 */
export class MessageListSessionDestinationController {
  private sequence = 0
  private requestToken: string | null = null
  private projection: { generation: number; segmentRevision: number } | null = null
  private state: MessageListDestinationState = { status: 'idle' }

  constructor(
    private readonly sessionId: MessageListSessionId,
    private readonly isDestroyed: () => boolean,
    private readonly notify: (
      state: MessageListDestinationState,
      options?: MessageListDestinationPublishOptions,
    ) => void,
  ) {}

  getState(): MessageListDestinationState { return this.state }

  dispatch(
    target: MessageListAnchor,
    start: (target: MessageIdentityAnchor) => void,
  ): MessageListDestinationDispatchResult {
    if (this.isDestroyed()) {
      return { status: 'rejected', reason: 'session-destroyed' }
    }

    // replacement 的 cancelled 与新 pending 一并延后发布，避免旧状态发布期间的
    // subscriber 重入插到本次 dispatch 中间，制造“受理但没有终态”的命令。
    this.cancel('superseded', { defer: true })
    const normalizedTarget = normalizeMessageListAnchor(this.sessionId, target)
    const destinationId = `${this.sessionId}:destination:${++this.sequence}`
    this.requestToken = null
    this.projection = null
    // 先同步受理并写入 pending，再由 Session state publisher 在当前调用栈结束后
    // 发布该状态。只有全部 subscriber 都观察到 pending，且命令仍为 current 时，
    // 才启动 runtime 工作；同步 destroy/supersede 因而不会泄漏旧请求。
    this.setState({
      status: 'pending',
      destinationId,
      target: normalizedTarget,
    }, {
      defer: true,
      afterNotify: () => {
        const current = this.state
        if (
          this.isDestroyed() ||
          current.status !== 'pending' ||
          current.destinationId !== destinationId
        ) return
        start(normalizedTarget)
      },
    })
    return { status: 'accepted', destinationId }
  }

  /**
   * 只取消当前匹配的 pending destination。先停止底层工作，再发布终态，确保订阅者
   * 看到 cancelled 时该 destination 已不可能继续 settle。
   */
  cancelDestination(
    input: MessageListDestinationCancelInput,
    stop: () => void,
  ): MessageListDestinationCancelResult {
    if (this.isDestroyed()) {
      return { status: 'ignored', reason: 'session-destroyed' }
    }
    const current = this.state
    if (current.status !== 'pending' || current.destinationId !== input.destinationId) {
      return { status: 'ignored', reason: 'not-current' }
    }

    stop()
    this.cancel(input.reason)
    return { status: 'cancelled', destinationId: input.destinationId }
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
    options?: MessageListDestinationPublishOptions,
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
    }, options)
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

  private setState(
    state: MessageListDestinationState,
    options?: MessageListDestinationPublishOptions,
  ): void {
    this.state = state
    this.notify(state, options)
  }
}

function sameTarget(left: MessageListAnchor, right: MessageIdentityAnchor): boolean {
  const stableId = left.stableId ?? left.serverId ?? left.localId ?? left.id
  return left.sessionId === right.sessionId && stableId === right.stableId
}
