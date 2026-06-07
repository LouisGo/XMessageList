import type { ScrollSource } from '../scroll/scrollIntentEngine'
import type { MessageListSnapshot } from '../contracts/snapshot'

type FollowBottomIntent = {
  sessionId: string
  generation: number
  lastScrollTop: number
}

const USER_SCROLL_DIRECTION_EPSILON_PX = 1

// follow-bottom intent 只在同一 session/generation 内有效；用户向上滚动即取消。
export class FollowBottomIntentTracker<TMessage, TOptimistic> {
  private intent: FollowBottomIntent | null = null

  clear(): void {
    this.intent = null
  }

  ensure(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
  ): void {
    if (this.has(snapshot)) {
      this.intent = {
        ...(this.intent as FollowBottomIntent),
        lastScrollTop: scrollTop,
      }
      return
    }

    this.intent = {
      sessionId: snapshot.sessionId,
      generation: snapshot.generation,
      lastScrollTop: scrollTop,
    }
  }

  has(snapshot: MessageListSnapshot<TMessage, TOptimistic>): boolean {
    return this.intent?.sessionId === snapshot.sessionId &&
      this.intent.generation === snapshot.generation
  }

  updateForScroll(
    snapshot: MessageListSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    source: ScrollSource,
  ): MessageListSnapshot<TMessage, TOptimistic> {
    const intent = this.intent

    if (!intent) {
      return snapshot
    }

    if (intent.sessionId !== snapshot.sessionId || intent.generation !== snapshot.generation) {
      this.clear()
      return snapshot
    }

    if (isUserDrivenScroll(source) &&
      scrollTop < intent.lastScrollTop - USER_SCROLL_DIRECTION_EPSILON_PX) {
      this.clear()
      return snapshot.pendingIntent === 'follow-bottom'
        ? { ...snapshot, pendingIntent: null }
        : snapshot
    }

    intent.lastScrollTop = scrollTop
    return snapshot
  }
}

function isUserDrivenScroll(source: ScrollSource): boolean {
  return source === 'user' || source === 'momentum'
}
