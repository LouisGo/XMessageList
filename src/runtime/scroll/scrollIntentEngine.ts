import type { BottomLockState } from '../contracts/snapshot'

export type ScrollSource =
  | 'user'
  | 'momentum'
  | 'programmatic'
  | 'recovery'
  | 'jump'
  | 'followBottom'
  | 'underflowFill'

type ScrollWriteToken = {
  source: ScrollSource
  expiresAtFrame: number
}

const USER_INTENT_FRAME_WINDOW = 90

export const DEFAULT_BOTTOM_LOCK_THRESHOLD_PX = 40
export const DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX = 120

/**
 * ScrollIntentEngine 区分用户意图、惯性滚动和 runtime 写入，避免程序性修正误触发底部锁状态。
 */
export class ScrollIntentEngine {
  private state: BottomLockState = 'UNLOCKED'

  private currentWrite: ScrollWriteToken | null = null

  private userIntentStartedAtFrame = -1

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
    // 用户输入优先级高于当前 programmatic write，并在后续若干帧内被视为 momentum。
    this.currentWrite = null
    if (this.userIntentExpiresAtFrame < currentFrame) {
      this.userIntentStartedAtFrame = currentFrame
    }
    this.userIntentExpiresAtFrame = Math.max(
      this.userIntentExpiresAtFrame,
      currentFrame + USER_INTENT_FRAME_WINDOW,
    )
  }

  clearTransientIntent(): void {
    this.currentWrite = null
    this.userIntentStartedAtFrame = -1
    this.userIntentExpiresAtFrame = -1
  }

  classifyScroll(currentFrame: number): ScrollSource {
    if (this.currentWrite && this.currentWrite.expiresAtFrame >= currentFrame) {
      return this.currentWrite.source
    }

    this.currentWrite = null

    if (this.userIntentExpiresAtFrame >= currentFrame) {
      return currentFrame <= this.userIntentStartedAtFrame + 1
        ? 'user'
        : 'momentum'
    }

    this.userIntentStartedAtFrame = -1
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
