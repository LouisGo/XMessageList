import type { BottomLockState, ScrollSource } from '../types'

type ScrollWriteToken = {
  source: ScrollSource
  expiresAtFrame: number
}

/**
 * ScrollIntentEngine 负责区分用户滚动和 runtime 写入。
 * 这可以防止 recovery / follow-bottom 写 scrollTop 时错误解除 bottom lock。
 */
export class ScrollIntentEngine {
  private state: BottomLockState = 'UNLOCKED'

  private currentWrite: ScrollWriteToken | null = null

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
  }

  markUserIntent(): void {
    this.currentWrite = null
  }

  classifyScroll(currentFrame: number): ScrollSource {
    if (this.currentWrite && this.currentWrite.expiresAtFrame >= currentFrame) {
      return this.currentWrite.source
    }

    this.currentWrite = null
    return 'user'
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
}
