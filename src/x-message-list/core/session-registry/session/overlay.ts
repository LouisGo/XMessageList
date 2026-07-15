import type {
  MessageListOverlayStatus,
  MessageListRequestResult,
  MessageListViewState,
} from '../contracts'
import type { ProjectionSettledEvent } from '../../runtime/index'

const OVERLAY_LOADING_DELAY_MS = 200

export class MessageListSessionOverlay {
  private overlayStatus: MessageListOverlayStatus
  private viewState: MessageListViewState
  private overlayRequestId = 0
  private overlayLoadingTimer: ReturnType<typeof setTimeout> | null = null
  private overlayPendingRequestId: number | null = null
  private awaitingProjection: {
    requestId: number
    generation: number
    segmentRevision: number
    surfaceFailure: boolean
  } | null = null
  private requestEpoch = 0

  constructor(
    private readonly notify: () => void,
    private readonly retry: () => void,
  ) {
    this.overlayStatus = this.createOverlayStatus('idle')
    this.viewState = {
      overlayStatus: this.overlayStatus,
    }
  }

  getViewState(): MessageListViewState {
    return this.viewState
  }

  getRequestEpoch(): number {
    return this.requestEpoch
  }

  startRequest(): number {
    this.overlayRequestId += 1
    const requestId = this.overlayRequestId
    this.overlayPendingRequestId = requestId
    this.awaitingProjection = null
    this.clearLoadingTimer()
    if (this.overlayStatus.status !== 'idle') {
      this.setStatus('idle')
    }
    this.overlayLoadingTimer = setTimeout(() => {
      if (
        this.overlayPendingRequestId === requestId &&
        this.overlayRequestId === requestId
      ) {
        this.setStatus('loading')
      }
    }, OVERLAY_LOADING_DELAY_MS)
    return requestId
  }

  finishRequest(
    overlayRequestId: number,
    status: MessageListOverlayStatus['status'],
    error?: unknown,
  ): void {
    if (overlayRequestId !== this.overlayRequestId) {
      return
    }

    this.overlayPendingRequestId = null
    this.awaitingProjection = null
    this.clearLoadingTimer()
    this.setStatus(status, error)
  }

  /** Only surface failures whose Retry callback can replay the failed operation. */
  finishRequestResult(
    overlayRequestId: number,
    result: Pick<MessageListRequestResult<unknown, unknown>, 'error' | 'status'>,
    surfaceFailure = true,
    projection?: { generation: number; segmentRevision: number },
  ): void {
    if (
      result.status === 'applied' &&
      projection &&
      overlayRequestId === this.overlayRequestId
    ) {
      this.overlayPendingRequestId = null
      this.awaitingProjection = {
        requestId: overlayRequestId,
        generation: projection.generation,
        segmentRevision: projection.segmentRevision,
        surfaceFailure,
      }
      // loading timer intentionally stays armed: request success is not a visual
      // success until the matching projection has measured and settled.
      return
    }
    const failed = surfaceFailure && result.status === 'failed'
    this.finishRequest(
      overlayRequestId,
      failed ? 'error' : 'idle',
      failed ? result.error : undefined,
    )
  }

  finishProjection(event: ProjectionSettledEvent): void {
    const awaiting = this.awaitingProjection
    if (
      !awaiting ||
      awaiting.requestId !== this.overlayRequestId ||
      awaiting.generation !== event.generation ||
      awaiting.segmentRevision !== event.segmentRevision
    ) return

    if (event.status === 'commit-timeout' && awaiting.surfaceFailure) {
      this.finishRequest(
        awaiting.requestId,
        'error',
        new Error('Message list projection commit timed out'),
      )
      return
    }

    this.finishRequest(awaiting.requestId, 'idle')
  }

  cancelRequest(): void {
    this.overlayRequestId += 1
    this.overlayPendingRequestId = null
    this.awaitingProjection = null
    this.clearLoadingTimer()
    if (this.overlayStatus.status !== 'idle') {
      this.setStatus('idle')
    }
  }

  bumpRequestEpoch(): void {
    this.requestEpoch += 1
  }

  isStaleRequest(overlayRequestId: number): boolean {
    return overlayRequestId !== this.overlayRequestId
  }

  isStaleEpoch(epoch: number): boolean {
    return epoch !== this.requestEpoch
  }

  destroy(): void {
    this.overlayRequestId += 1
    this.overlayPendingRequestId = null
    this.awaitingProjection = null
    this.requestEpoch += 1
    this.clearLoadingTimer()
  }

  private createOverlayStatus(
    status: MessageListOverlayStatus['status'],
    error?: unknown,
  ): MessageListOverlayStatus {
    return {
      status,
      error,
      retry: this.retry,
    }
  }

  private setStatus(
    status: MessageListOverlayStatus['status'],
    error?: unknown,
  ): void {
    this.overlayStatus = this.createOverlayStatus(status, error)
    this.viewState = {
      overlayStatus: this.overlayStatus,
    }
    this.notify()
  }

  private clearLoadingTimer(): void {
    if (this.overlayLoadingTimer === null) {
      return
    }

    clearTimeout(this.overlayLoadingTimer)
    this.overlayLoadingTimer = null
  }
}
