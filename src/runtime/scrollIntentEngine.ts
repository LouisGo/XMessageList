import type { BottomLockState } from './snapshot'

export type ScrollSource =
  | 'user'
  | 'momentum'
  | 'programmatic'
  | 'recovery'
  | 'destination'
  | 'followBottom'

type ScrollWriteToken = {
  source: ScrollSource
  expiresAtFrame: number
}

const USER_INTENT_FRAME_WINDOW = 90

export const DEFAULT_BOTTOM_LOCK_THRESHOLD_PX = 40
export const DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX = 120

export class ScrollIntentEngine {
  private state: BottomLockState = 'UNLOCKED'

  private currentWrite: ScrollWriteToken | null = null

  private userIntentExpiresAtFrame = -1

  constructor(
    private readonly lockThresholdPx = DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
    private readonly unlockThresholdPx = DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
  ) {}

  getBottomLockState(): BottomLockState {
    return this.state
  }

  setBottomLockState(state: BottomLockState): boolean {
    if (this.state === state) {
      return false
    }

    this.state = state
    return true
  }

  markScrollWrite(source: ScrollSource, currentFrame: number): void {
    this.currentWrite = {
      source,
      expiresAtFrame: currentFrame + 2,
    }
  }

  hasActiveScrollWrite(currentFrame: number): boolean {
    return Boolean(
      this.currentWrite && this.currentWrite.expiresAtFrame >= currentFrame,
    )
  }

  markUserIntent(currentFrame: number): void {
    this.currentWrite = null
    this.userIntentExpiresAtFrame = Math.max(
      this.userIntentExpiresAtFrame,
      currentFrame + USER_INTENT_FRAME_WINDOW,
    )
  }

  clearTransientIntent(): void {
    this.currentWrite = null
    this.userIntentExpiresAtFrame = -1
  }

  classifyScroll(currentFrame: number): ScrollSource {
    if (this.currentWrite && this.currentWrite.expiresAtFrame >= currentFrame) {
      return this.currentWrite.source
    }

    this.currentWrite = null

    if (this.userIntentExpiresAtFrame >= currentFrame) {
      return 'user'
    }

    this.userIntentExpiresAtFrame = -1
    return 'programmatic'
  }

  updateBottomLockFromDistance(
    distanceToBottom: number,
    currentFrame: number,
    source = this.classifyScroll(currentFrame),
  ): boolean {
    if (
      distanceToBottom <= this.lockThresholdPx &&
      (
        source === 'user' ||
        source === 'momentum' ||
        this.hasActiveUserIntent(currentFrame)
      )
    ) {
      return this.setBottomLockState('LOCKED')
    }

    if (source !== 'user' && source !== 'momentum') {
      return false
    }

    if (distanceToBottom > this.unlockThresholdPx) {
      return this.setBottomLockState('UNLOCKED')
    }

    return false
  }

  reconcileBottomLockFromDistance(distanceToBottom: number): boolean {
    if (distanceToBottom <= this.lockThresholdPx) {
      return this.setBottomLockState('LOCKED')
    }

    return false
  }

  private hasActiveUserIntent(currentFrame: number): boolean {
    return this.userIntentExpiresAtFrame >= currentFrame
  }
}
