import {
  USER_SCROLL_DIRECTION_EPSILON_PX,
  type ActiveFollowBottomIntent,
  type RuntimeDiagnosticEmitter,
} from '../state/runtimeTypes'
import type { MessageDataSnapshot, ScrollSource } from '../../types'

type ActiveFollowBottomIntentDeps<TMessage, TOptimistic> = {
  getDataSnapshot: () => MessageDataSnapshot<TMessage, TOptimistic> | null
  emitDiagnostic: RuntimeDiagnosticEmitter
}

export class ActiveFollowBottomIntentTracker<TMessage, TOptimistic> {
  private intent: ActiveFollowBottomIntent | null = null
  private commandCounter = 0

  constructor(
    private readonly deps: ActiveFollowBottomIntentDeps<TMessage, TOptimistic>,
  ) {}

  has(data: MessageDataSnapshot<TMessage, TOptimistic>): boolean {
    return (
      this.intent?.feedId === data.feedId &&
      this.intent.generation === data.generation
    )
  }

  clear(reason: string): void {
    const intent = this.intent

    if (!intent) {
      return
    }

    this.intent = null
    this.deps.emitDiagnostic({
      channel: 'motion',
      severity: 'debug',
      name: 'followBottom.intent.clear',
      correlationId: `command:${intent.commandId}`,
      details: () => ({
        reason,
        feedId: intent.feedId,
        generation: intent.generation,
        lastScrollTop: intent.lastScrollTop,
      }),
    })
  }

  updateForScroll(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
    scrollSource: ScrollSource,
  ): 'user-scroll-up' | null {
    const intent = this.intent

    if (!intent) {
      return null
    }

    if (intent.feedId !== data.feedId || intent.generation !== data.generation) {
      this.clear('generation-change')
      return null
    }

    if (
      scrollSource === 'user' &&
      scrollTop < intent.lastScrollTop - USER_SCROLL_DIRECTION_EPSILON_PX
    ) {
      this.clear('user-scroll-up')
      return 'user-scroll-up'
    }

    intent.lastScrollTop = scrollTop
    return null
  }

  recordScrollWrite(scrollTop: number, source: ScrollSource): void {
    const intent = this.intent
    const data = this.deps.getDataSnapshot()

    if (
      !intent ||
      !data ||
      source !== 'followBottom' ||
      intent.feedId !== data.feedId ||
      intent.generation !== data.generation
    ) {
      return
    }

    intent.lastScrollTop = scrollTop
  }

  // auto-scroll-to-bottom 和 motion supersede 会复用同一个追底意图，避免 resize 后误判为普通跳转。
  ensure(
    data: MessageDataSnapshot<TMessage, TOptimistic>,
    scrollTop: number,
  ): ActiveFollowBottomIntent {
    if (this.has(data)) {
      const intent = this.intent as ActiveFollowBottomIntent
      intent.lastScrollTop = scrollTop
      return intent
    }

    this.commandCounter += 1
    const intent = {
      feedId: data.feedId,
      generation: data.generation,
      commandId: `follow-bottom-${this.commandCounter}`,
      lastScrollTop: scrollTop,
    }

    this.intent = intent
    this.deps.emitDiagnostic({
      channel: 'motion',
      severity: 'info',
      name: 'followBottom.intent.start',
      correlationId: `command:${intent.commandId}`,
      details: () => ({
        revision: data.revision,
        itemCount: data.items.length,
        hasMoreAfter: data.hasMoreAfter,
        scrollTop,
      }),
    })
    return intent
  }
}
