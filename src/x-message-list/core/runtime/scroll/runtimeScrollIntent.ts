import type { RuntimeMeasurement } from '../dom/measurement'
import type { MessageListRuntimeOptions } from '../contracts/options'
import {
  DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
  DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
  ScrollIntentEngine,
  type ScrollSource,
} from './scrollIntentEngine'
import type { MessageListSnapshot } from '../contracts/snapshot'

export class RuntimeScrollIntentCoordinator {
  private readonly scrollIntent: ScrollIntentEngine

  private currentFrame = 0

  private lastScrollSource: ScrollSource | null = null

  constructor(options: MessageListRuntimeOptions) {
    this.scrollIntent = new ScrollIntentEngine(
      options.bottomLockThresholdPx ?? DEFAULT_BOTTOM_LOCK_THRESHOLD_PX,
      options.bottomUnlockThresholdPx ?? DEFAULT_BOTTOM_UNLOCK_THRESHOLD_PX,
    )
  }

  getLastScrollSource(): ScrollSource | null {
    return this.lastScrollSource
  }

  incrementFrame(): void {
    this.currentFrame += 1
  }

  markScrollWrite(source: ScrollSource): void {
    this.scrollIntent.markScrollWrite(source, this.currentFrame)
  }

  markUserScrollIntent(): void {
    this.scrollIntent.markUserIntent(this.currentFrame)
  }

  classifyCurrentScroll(): ScrollSource {
    return this.scrollIntent.classifyScroll(this.currentFrame)
  }

  classifyFrameScroll(): ScrollSource {
    this.incrementFrame()
    this.lastScrollSource = this.classifyCurrentScroll()
    return this.lastScrollSource
  }

  syncBottomLock<TMessage, TOptimistic>(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
  ): void {
    this.scrollIntent.setBottomLockState(snapshot.bottomLockState)
  }

  updateBottomLock<TMessage, TOptimistic>(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    measurement: RuntimeMeasurement,
    scrollSource: ScrollSource,
    previousScrollTop = measurement.scrollTop,
  ): {
    changed: boolean
    snapshot: MessageListSnapshot<TMessage, TOptimistic>
  } {
    const distanceToBottom = Math.max(
      0,
      measurement.scrollHeight - measurement.clientHeight - measurement.scrollTop,
    )
    const userScrolledUp = isUserDrivenScroll(scrollSource) &&
      measurement.scrollTop < previousScrollTop - 1
    const changed = snapshot.segmentMeta.hasMoreAfter || userScrolledUp
      ? this.scrollIntent.setBottomLockState('UNLOCKED')
      : this.scrollIntent.updateBottomLockFromDistance(
          distanceToBottom,
          this.currentFrame,
          scrollSource,
        )

    if (!changed) {
      return { changed, snapshot }
    }

    return {
      changed,
      snapshot: {
        ...snapshot,
        bottomLockState: this.scrollIntent.getBottomLockState(),
      },
    }
  }
}

function isUserDrivenScroll(source: ScrollSource): boolean {
  return source === 'user' || source === 'momentum'
}
