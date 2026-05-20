import type { BottomLockState, ScrollSource } from '../types'

type ScrollWriteToken = {
  source: ScrollSource
  expiresAtFrame: number
}

const USER_INTENT_FRAME_WINDOW = 90

/**
 * ScrollIntentEngine 负责区分用户滚动和 runtime 写入。
 * 这可以防止 recovery / follow-bottom 写 scrollTop 时错误解除 bottom lock。
 */
export class ScrollIntentEngine {
  private state: BottomLockState = 'UNLOCKED'

  private currentWrite: ScrollWriteToken | null = null

  private userIntentExpiresAtFrame = -1

  constructor(
    private readonly lockThresholdPx: number,
    private readonly unlockThresholdPx: number,
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
    this.userIntentExpiresAtFrame = -1
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
    if (source !== 'user' && source !== 'momentum') {
      return false
    }

    if (distanceToBottom <= this.lockThresholdPx) {
      return this.setBottomLockState('LOCKED')
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
}
