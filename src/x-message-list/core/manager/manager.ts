import { MessageListSession } from './session'
import type {
  MessageListConversationId,
  MessageListManager,
  MessageListManagerOptions,
  MessageListSessionId,
  MessageListSessionRegistry,
  MessageListSessionRegistryEntry,
  MessageListSessionRegistryOptions,
  MessageListSessionRegistryOptionsPatch,
  MessageListSessionRetainReason,
  MessageListSession as PublicMessageListSession,
} from './types'

const DEFAULT_PAGE_SIZE = 30
const DEFAULT_MAX_ITEMS = 300
const DEFAULT_MAX_SESSIONS = 20
const DEFAULT_TTL_MS = 10 * 60_000

type NormalizedDefaults = {
  pageSize: number
  maxItems: number
  keepAlive: {
    maxSessions: number
    ttlMs: number
  }
}

type SessionRecord<Row, Feed> = {
  session: MessageListSession<Row, Feed>
  createdAt: number
  hostRetains: Map<MessageListSessionRetainReason, number>
}

export class ApplicationMessageListManager<Row, Feed = MessageListConversationId>
  implements MessageListSessionRegistry<Row, Feed> {
  private readonly sessions = new Map<
    MessageListSessionId,
    SessionRecord<Row, Feed>
  >()
  private defaults: NormalizedDefaults

  constructor(
    private options: MessageListSessionRegistryOptions<Row, Feed>,
  ) {
    this.defaults = normalizeDefaults(options.defaults)
  }

  getSession(id: MessageListSessionId): PublicMessageListSession<Row> {
    this.sweep()
    const existing = this.sessions.get(id)?.session

    if (existing) {
      existing.lastUsedAt = Date.now()
      return existing
    }

    const feed = this.getFeed(id)
    const adapter = this.options.getAdapter(feed)
    const session = new MessageListSession({
      id,
      conversation: feed,
      adapter,
      defaults: this.defaults,
      incoming: {
        getPageFocus: () => resolvePageFocus(this.getIncomingOptions()?.getPageFocus),
        shouldFollowAppend: (context) =>
          this.getIncomingOptions()?.shouldFollowAppend?.(context),
      },
      scrollMotion: {
        enabled: () => {
          const enabled = this.options.scrollMotion?.enabled
          return typeof enabled === 'function' ? enabled() : enabled ?? true
        },
      },
      onRequestResult: (result) => this.options.onRequestResult?.(result),
    })

    this.sessions.set(id, {
      session,
      createdAt: Date.now(),
      hostRetains: new Map(),
    })
    this.evictOverflow()
    return session
  }

  hasSession(id: MessageListSessionId): boolean {
    return this.sessions.has(id)
  }

  destroySession(id: MessageListSessionId): boolean {
    const session = this.sessions.get(id)?.session

    if (!session) {
      return false
    }

    session.destroy()
    return this.sessions.delete(id)
  }

  destroyAll(): void {
    for (const { session } of this.sessions.values()) {
      session.destroy()
    }
    this.sessions.clear()
  }

  getSessionIds(): MessageListSessionId[] {
    return Array.from(this.sessions.keys())
  }

  getSessionMeta(id: MessageListSessionId): MessageListSessionRegistryEntry | null {
    const record = this.sessions.get(id)

    if (!record) {
      return null
    }

    const mountedRetainCount = record.session.getViewRetainCount()
    const hostRetainCount = getHostRetainCount(record)

    return {
      sessionId: id,
      feedId: id,
      createdAt: record.createdAt,
      lastUsedAt: record.session.lastUsedAt,
      mountedRetainCount,
      hostRetainCount,
      status: mountedRetainCount > 0
        ? 'mounted'
        : hostRetainCount > 0
          ? 'active'
          : 'cached',
    }
  }

  retainSession(
    id: MessageListSessionId,
    reason: MessageListSessionRetainReason,
  ): () => void {
    this.getSession(id)
    const record = this.sessions.get(id)

    if (!record) {
      return () => undefined
    }

    record.session.lastUsedAt = Date.now()
    record.hostRetains.set(reason, (record.hostRetains.get(reason) ?? 0) + 1)

    let released = false
    return () => {
      if (released) {
        return
      }

      released = true
      const current = record.hostRetains.get(reason) ?? 0
      if (current <= 1) {
        record.hostRetains.delete(reason)
      } else {
        record.hostRetains.set(reason, current - 1)
      }
      record.session.lastUsedAt = Date.now()
    }
  }

  updateOptions(options: MessageListSessionRegistryOptionsPatch<Row, Feed>): void {
    this.options = {
      ...this.options,
      defaults: {
        ...this.options.defaults,
        pageSize: options.defaults?.pageSize ??
          this.options.defaults?.pageSize,
        keepAlive: {
          ...this.options.defaults?.keepAlive,
          ...options.defaults?.keepAlive,
        },
      },
      tailEvents: options.tailEvents
        ? { ...this.options.tailEvents, ...options.tailEvents }
        : this.options.tailEvents,
      incoming: options.incoming
        ? { ...this.options.incoming, ...options.incoming }
        : this.options.incoming,
      scrollMotion: options.scrollMotion ?? this.options.scrollMotion,
      onRequestResult: options.onRequestResult ?? this.options.onRequestResult,
    }
    const nextDefaults = normalizeDefaults(this.options.defaults)
    this.defaults.pageSize = nextDefaults.pageSize
    this.defaults.keepAlive = nextDefaults.keepAlive
    this.sweep()
    this.evictOverflow()
  }

  sweep(): void {
    const now = Date.now()
    const ttl = this.defaults.keepAlive.ttlMs

    if (ttl <= 0) {
      return
    }

    for (const [id, record] of this.sessions) {
      if (this.isActiveRecord(record)) {
        continue
      }

      if (now - record.session.lastUsedAt > ttl) {
        this.destroySession(id)
      }
    }
  }

  private getFeed(id: MessageListSessionId): Feed {
    if (this.options.getFeed) {
      return this.options.getFeed(id)
    }

    if (this.options.getConversation) {
      return this.options.getConversation(id)
    }

    return id as Feed
  }

  private evictOverflow(): void {
    const maxSessions = this.defaults.keepAlive.maxSessions

    if (maxSessions <= 0) {
      return
    }

    while (this.getCachedSessionCount() > maxSessions) {
      const oldest = Array.from(this.sessions.entries())
        .filter(([, record]) => !this.isActiveRecord(record))
        .sort((left, right) =>
          left[1].session.lastUsedAt - right[1].session.lastUsedAt
        )[0]

      if (!oldest) {
        return
      }

      this.destroySession(oldest[0])
    }
  }

  private getCachedSessionCount(): number {
    return Array.from(this.sessions.values())
      .filter((record) => !this.isActiveRecord(record))
      .length
  }

  private isActiveRecord(record: SessionRecord<Row, Feed>): boolean {
    return record.session.hasRetainedView() || getHostRetainCount(record) > 0
  }

  private getIncomingOptions(): MessageListManagerOptions<Row, Feed>['incoming'] {
    const tailEvents = this.options.tailEvents

    if (!tailEvents) {
      return this.options.incoming
    }

    return {
      getPageFocus: tailEvents.getPageFocus,
      shouldFollowAppend: tailEvents.shouldFollowRemoteAppend,
    }
  }
}

export function createMessageListSessionRegistry<
  Row,
  Feed = MessageListConversationId,
>(
  options: MessageListSessionRegistryOptions<Row, Feed>,
): MessageListSessionRegistry<Row, Feed> {
  return new ApplicationMessageListManager<Row, Feed>(options)
}

/** @deprecated Use createMessageListSessionRegistry. */
export function createMessageListManager<Row, Conversation = MessageListConversationId>(
  options: MessageListManagerOptions<Row, Conversation>,
): MessageListManager<Row, Conversation> {
  return createMessageListSessionRegistry<Row, Conversation>(options)
}

function normalizeDefaults(
  defaults: MessageListManagerOptions<unknown>['defaults'],
): NormalizedDefaults {
  return {
    pageSize: defaults?.pageSize ?? DEFAULT_PAGE_SIZE,
    maxItems: defaults?.maxItems ?? DEFAULT_MAX_ITEMS,
    keepAlive: {
      maxSessions: defaults?.keepAlive?.maxSessions ?? DEFAULT_MAX_SESSIONS,
      ttlMs: defaults?.keepAlive?.ttlMs ?? DEFAULT_TTL_MS,
    },
  }
}

function getHostRetainCount<Row, Feed>(record: SessionRecord<Row, Feed>): number {
  let count = 0

  for (const value of record.hostRetains.values()) {
    count += value
  }

  return count
}

function resolvePageFocus(getPageFocus?: () => boolean): boolean {
  if (getPageFocus) {
    return getPageFocus()
  }

  return globalThis.document?.hasFocus?.() ?? true
}
