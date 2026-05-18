export type RuntimeGenerationToken = {
  feedId: string
  generation: number
}

/**
 * LifecycleGuard 是所有异步回调的第一道闸门。
 * feed 切换、detach、destroy 后，旧 rAF / timeout / observer 回调不能再提交状态。
 */
export class LifecycleGuard {
  private feedId: string

  private generation: number

  private active = true

  private destroyed = false

  constructor(feedId = '', generation = 0) {
    this.feedId = feedId
    this.generation = generation
  }

  getCurrent(): RuntimeGenerationToken {
    return {
      feedId: this.feedId,
      generation: this.generation,
    }
  }

  reset(feedId: string, generation: number): RuntimeGenerationToken {
    this.feedId = feedId
    this.generation = generation
    this.active = true
    return this.getCurrent()
  }

  suspend(): void {
    this.active = false
  }

  resume(): void {
    if (!this.destroyed) {
      this.active = true
    }
  }

  destroy(): void {
    this.active = false
    this.destroyed = true
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  isCurrent(feedId: string, generation: number): boolean {
    return (
      this.active &&
      !this.destroyed &&
      this.feedId === feedId &&
      this.generation === generation
    )
  }
}
