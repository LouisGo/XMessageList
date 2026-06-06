import type {
  MessageListOverlayStatus,
  MessageListViewState,
} from '../contracts'

const OVERLAY_LOADING_DELAY_MS = 200

export class MessageListSessionOverlay {
  private overlayStatus: MessageListOverlayStatus
  private viewState: MessageListViewState
  private overlayRequestId = 0
  private overlayLoadingTimer: ReturnType<typeof setTimeout> | null = null
  private overlayPendingRequestId: number | null = null
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
    this.clearLoadingTimer()
    this.setStatus(status, error)
  }

  cancelRequest(): void {
    this.overlayRequestId += 1
    this.overlayPendingRequestId = null
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
